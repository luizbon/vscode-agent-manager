import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';
import { AgentParser } from '../../domain/services/agentParser';
import { SkillParser } from '../../domain/services/skillParser';

export class LocalWorkspaceStorage {

    private static findFilesRecursive(dir: string, isSkill: boolean): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) { return results; }
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...LocalWorkspaceStorage.findFilesRecursive(fullPath, isSkill));
                } else if (isSkill
                    ? (entry.name === 'SKILL.md' || entry.name.endsWith('.skill.md'))
                    : entry.name.endsWith('.agent.md')) {
                    results.push(fullPath);
                }
            }
        } catch (e) {
            console.error(`Error reading directory ${dir}:`, e);
        }
        return results;
    }

    public static async getInstalledItems(): Promise<{ agents: Agent[], skills: Skill[] }> {
        const agents: Agent[] = [];
        const skills: Skill[] = [];

        if (vscode.workspace.workspaceFolders) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('chat');

            // Collect Agent paths
            const agentSetting = config.get<string[]>('agentFilesLocations');
            const agentPaths = Array.isArray(agentSetting) ? [...agentSetting] : [];
            if (!agentPaths.includes('.github/agents')) { agentPaths.push('.github/agents'); }

            // Collect Skill paths
            const skillSetting = config.get<string[]>('agentSkillsLocations');
            const skillPaths = Array.isArray(skillSetting) ? [...skillSetting] : [];
            if (!skillPaths.includes('.github/skills')) { skillPaths.push('.github/skills'); }

            for (const loc of agentPaths) {
                const dirPath = path.isAbsolute(loc) ? loc : path.join(workspaceRoot, loc);
                for (const fullPath of LocalWorkspaceStorage.findFilesRecursive(dirPath, false)) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const agent = AgentParser.parse(content, 'Workspace', fullPath);
                        if (agent) { agents.push(agent); }
                    } catch (e) { console.error(`Error parsing agent ${fullPath}:`, e); }
                }
            }

            for (const loc of skillPaths) {
                const dirPath = path.isAbsolute(loc) ? loc : path.join(workspaceRoot, loc);
                for (const fullPath of LocalWorkspaceStorage.findFilesRecursive(dirPath, true)) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const skill = SkillParser.parse(content, 'Workspace', fullPath);
                        if (skill) { skills.push(skill); }
                    } catch (e) { console.error(`Error parsing skill ${fullPath}:`, e); }
                }
            }
        }

        return { agents, skills };
    }
}
