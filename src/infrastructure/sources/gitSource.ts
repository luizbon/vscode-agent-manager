import * as path from 'path';
import * as upath from 'upath';
import * as fs from 'fs';
import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';
import { CliPlugin } from '../../domain/models/cliPlugin';
import { AgentParser } from '../../domain/services/agentParser';
import { SkillParser } from '../../domain/services/skillParser';
import { PluginMarketplaceParser } from '../../domain/services/pluginMarketplaceParser';
import { isMarketplaceFile, isAdHocPluginManifest } from '../../domain/models/pluginMarketplace';
import { IMarketplaceSource } from '../../application/ports/marketplaceSource';
import { GitService } from '../../services/gitService';
import { TelemetryService } from '../../services/telemetry';

/** Directories to skip when recursively searching a cloned repo */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'out', 'build', '.next', '__pycache__']);

export type FetchMode = 'agent' | 'plugin';

export class GitSource implements IMarketplaceSource {
    public async fetchItems(
        repoUrl: string,
        globalStoragePath: string,
        mode: FetchMode = 'agent'
    ): Promise<{ agents: Agent[]; skills: Skill[]; cliPlugins?: CliPlugin[] }> {
        const gitService = new GitService();
        const repoDirName = gitService.getRepoDirName(repoUrl);
        const destPath = path.join(globalStoragePath, 'repos', repoDirName);

        await gitService.cloneOrPullRepo(repoUrl, destPath);

        if (mode === 'plugin') {
            return this.fetchPlugins(repoUrl, destPath);
        }

        return this.fetchAgentsAndSkills(repoUrl, destPath);
    }

    // -------------------------------------------------------------------------
    // Agent / Skill mode
    // -------------------------------------------------------------------------

    private async fetchAgentsAndSkills(
        repoUrl: string,
        destPath: string
    ): Promise<{ agents: Agent[]; skills: Skill[]; cliPlugins: CliPlugin[] }> {
        const filePaths = await this.findAgentSkillFiles(destPath);

        const agents: Agent[] = [];
        const skills: Skill[] = [];
        let parsedAgents = 0;
        let parsedSkills = 0;
        let parseErrors = 0;

        for (const filePath of filePaths) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const fileName = path.basename(filePath);
                const isSkill = fileName === 'SKILL.md' || fileName.endsWith('.skill.md');

                let baseDirectory = '';
                if (fileName === 'SKILL.md') {
                    const normalizedDestPath = upath.toUnix(destPath);
                    const normalizedFilePath = upath.toUnix(filePath);
                    const relativePath = upath.relative(normalizedDestPath, normalizedFilePath);
                    const dirPath = upath.dirname(relativePath);

                    if (dirPath !== '.') {
                        const parentName = upath.basename(dirPath);
                        if (parentName.toLowerCase() !== 'skills' && parentName.toLowerCase() !== 'skill') {
                            baseDirectory = parentName;
                        }
                    }
                }

                if (isSkill) {
                    const skill = SkillParser.parse(content, repoUrl, filePath, baseDirectory);
                    if (skill) { skills.push(skill); parsedSkills++; }
                } else {
                    const agent = AgentParser.parse(content, repoUrl, filePath, baseDirectory);
                    if (agent) { agents.push(agent); parsedAgents++; }
                }
            } catch (error) {
                console.error(`Failed to parse item ${filePath}:`, error);
                TelemetryService.getInstance().sendError(error as Error, { context: 'itemParse', filePath, repoUrl });
                parseErrors++;
            }
        }

        this.sendParseOutcomeTelemetry(repoUrl, filePaths.length, parsedAgents, parsedSkills, 0, parseErrors, false);
        return { agents, skills, cliPlugins: [] };
    }

    // -------------------------------------------------------------------------
    // Plugin mode
    // -------------------------------------------------------------------------

    private async fetchPlugins(
        repoUrl: string,
        destPath: string
    ): Promise<{ agents: Agent[]; skills: Skill[]; cliPlugins: CliPlugin[] }> {
        // Step 1: search everywhere for marketplace.json files
        const marketplacePaths = await this.findFilesByName(destPath, 'marketplace.json');
        const cliPlugins: CliPlugin[] = [];
        let parseErrors = 0;

        if (marketplacePaths.length > 0) {
            // Step 2a: parse each marketplace.json found
            for (const mPath of marketplacePaths) {
                try {
                    const raw = await fs.promises.readFile(mPath, 'utf-8');
                    const json = JSON.parse(raw);
                    if (isMarketplaceFile(json)) {
                        const relPath = upath.relative(upath.toUnix(destPath), upath.toUnix(mPath));
                        const plugins = PluginMarketplaceParser.parse(json, repoUrl, relPath, destPath);
                        cliPlugins.push(...plugins);
                    }
                } catch (error) {
                    console.error(`Failed to parse marketplace file ${mPath}:`, error);
                    TelemetryService.getInstance().sendError(error as Error, { context: 'marketplaceParse', filePath: mPath, repoUrl });
                    parseErrors++;
                }
            }

            this.sendParseOutcomeTelemetry(repoUrl, marketplacePaths.length, 0, 0, cliPlugins.length, parseErrors, true);
        } else {
            // Step 2b: no marketplace.json found — scan for ad-hoc JSON manifests
            const jsonPaths = await this.findJsonFiles(destPath);

            for (const jPath of jsonPaths) {
                try {
                    const raw = await fs.promises.readFile(jPath, 'utf-8');
                    const json = JSON.parse(raw);
                    const fileName = path.basename(jPath);

                    if (isAdHocPluginManifest(json, fileName)) {
                        const relPath = upath.relative(upath.toUnix(destPath), upath.toUnix(jPath));
                        const plugin = PluginMarketplaceParser.parseAdHoc(json as Record<string, unknown>, repoUrl, relPath, destPath);
                        if (plugin) { cliPlugins.push(plugin); }
                    }
                } catch {
                    // Silent: malformed JSON in arbitrary files is expected
                }
            }

            this.sendParseOutcomeTelemetry(repoUrl, jsonPaths.length, 0, 0, cliPlugins.length, parseErrors, false);
        }

        return { agents: [], skills: [], cliPlugins };
    }

    // -------------------------------------------------------------------------
    // File discovery helpers
    // -------------------------------------------------------------------------

    /** Recursively finds .agent.md / .skill.md / SKILL.md files */
    private async findAgentSkillFiles(dir: string): Promise<string[]> {
        const results: string[] = [];
        try {
            if (!fs.existsSync(dir)) { return results; }
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name)) {
                        results.push(...await this.findAgentSkillFiles(fullPath));
                    }
                } else if (
                    entry.name.endsWith('.agent.md') ||
                    entry.name.endsWith('.skill.md') ||
                    entry.name === 'SKILL.md'
                ) {
                    results.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
            TelemetryService.getInstance().sendError(error as Error, { context: 'itemFileDiscovery', dir });
        }
        return results;
    }

    /** Recursively finds files with an exact name (e.g. "marketplace.json") */
    private async findFilesByName(dir: string, targetName: string): Promise<string[]> {
        const results: string[] = [];
        try {
            if (!fs.existsSync(dir)) { return results; }
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name)) {
                        results.push(...await this.findFilesByName(fullPath, targetName));
                    }
                } else if (entry.name === targetName) {
                    results.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error searching directory ${dir}:`, error);
            TelemetryService.getInstance().sendError(error as Error, { context: 'marketplaceDiscovery', dir });
        }
        return results;
    }

    /** Recursively finds all *.json files (for ad-hoc plugin fallback) */
    private async findJsonFiles(dir: string): Promise<string[]> {
        const results: string[] = [];
        try {
            if (!fs.existsSync(dir)) { return results; }
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name)) {
                        results.push(...await this.findJsonFiles(fullPath));
                    }
                } else if (entry.name.endsWith('.json')) {
                    results.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error scanning JSON files in ${dir}:`, error);
        }
        return results;
    }

    // -------------------------------------------------------------------------
    // Telemetry
    // -------------------------------------------------------------------------

    private sendParseOutcomeTelemetry(
        repoUrl: string,
        filesScanned: number,
        parsedAgents: number,
        parsedSkills: number,
        parsedPlugins: number,
        parseErrors: number,
        foundMarketplace: boolean
    ): void {
        try {
            const host = new URL(repoUrl).hostname;
            TelemetryService.getInstance().sendEvent('repository.parse.outcome', {
                repoUrl,
                host,
                totalFilesFound: filesScanned.toString(),
                parsedAgents: parsedAgents.toString(),
                parsedSkills: parsedSkills.toString(),
                parsedCliPlugins: parsedPlugins.toString(),
                parseErrors: parseErrors.toString(),
                foundMarketplace: foundMarketplace.toString()
            });
        } catch {
            TelemetryService.getInstance().sendEvent('repository.parse.outcome', {
                repoUrl,
                host: 'unknown',
                totalFilesFound: filesScanned.toString(),
                parsedAgents: parsedAgents.toString(),
                parsedSkills: parsedSkills.toString(),
                parsedCliPlugins: parsedPlugins.toString(),
                parseErrors: parseErrors.toString(),
                foundMarketplace: foundMarketplace.toString()
            });
        }
    }
}
