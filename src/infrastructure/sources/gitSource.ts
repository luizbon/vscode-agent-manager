import * as path from 'path';
import * as upath from 'upath';
import * as fs from 'fs';
import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';
import { AgentParser } from '../../domain/services/agentParser';
import { SkillParser } from '../../domain/services/skillParser';
import { IMarketplaceSource } from '../../application/ports/marketplaceSource';
import { GitService } from '../../services/gitService';

export class GitSource implements IMarketplaceSource {
    public async fetchItems(repoUrl: string, globalStoragePath: string): Promise<{ agents: Agent[], skills: Skill[] }> {
        const gitService = new GitService();
        const repoDirName = gitService.getRepoDirName(repoUrl);
        const destPath = path.join(globalStoragePath, 'repos', repoDirName);

        await gitService.cloneOrPullRepo(repoUrl, destPath);

        const filePaths = await this.findFiles(destPath);
        const agents: Agent[] = [];
        const skills: Skill[] = [];

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

                        // Use the parent folder name unless it's a generic 'skills' or 'skill' folder
                        if (parentName.toLowerCase() !== 'skills' && parentName.toLowerCase() !== 'skill') {
                            baseDirectory = parentName;
                        }
                    }
                }

                if (isSkill) {
                    const skill = SkillParser.parse(content, repoUrl, filePath, baseDirectory);
                    if (skill) { skills.push(skill); }
                } else {
                    const agent = AgentParser.parse(content, repoUrl, filePath, baseDirectory);
                    if (agent) { agents.push(agent); }
                }
            } catch (error) {
                console.error(`Failed to parse item ${filePath}:`, error);
            }
        }

        return { agents, skills };
    }

    private async findFiles(dir: string): Promise<string[]> {
        let results: string[] = [];
        try {
            if (!fs.existsSync(dir)) { return results; }
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== '.git') {
                        results.push(...await this.findFiles(fullPath));
                    }
                } else if (entry.name.endsWith('.agent.md') || entry.name.endsWith('.skill.md') || entry.name === 'SKILL.md') {
                    results.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
        }
        return results;
    }
}
