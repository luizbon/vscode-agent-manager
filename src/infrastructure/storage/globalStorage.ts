import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';
import { AgentParser } from '../../domain/services/agentParser';
import { SkillParser } from '../../domain/services/skillParser';

export class GlobalStorage {
    constructor(private globalStoragePath: string) { }

    private findFilesRecursive(dir: string, isSkill: boolean): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) { return results; }
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...this.findFilesRecursive(fullPath, isSkill));
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

    public getInstalledItems(): { agents: Agent[], skills: Skill[] } {
        const agents: Agent[] = [];
        const skills: Skill[] = [];

        // Global Agents (prompts)
        const userDir = path.dirname(path.dirname(this.globalStoragePath));
        const userPath = path.join(userDir, 'prompts');

        for (const fullPath of this.findFilesRecursive(userPath, false)) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const agent = AgentParser.parse(content, 'Global', fullPath);
                if (agent) { agents.push(agent); }
            } catch (e) { console.error(`Error parsing global agent ${fullPath}:`, e); }
        }

        // Global Skills (~/.copilot/skills) - skills can be in subdirectories
        const globalSkillPath = path.join(os.homedir(), '.copilot', 'skills');
        for (const fullPath of this.findFilesRecursive(globalSkillPath, true)) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const skill = SkillParser.parse(content, 'Global', fullPath);
                if (skill) { skills.push(skill); }
            } catch (e) { console.error(`Error parsing global skill ${fullPath}:`, e); }
        }

        return { agents, skills };
    }
}
