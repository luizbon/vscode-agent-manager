import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Agent } from './agentDiscovery';
import { AgentParser } from './agentParser';
import { GitService } from './gitService';

export interface IAgentSource {
    fetchAgents(sourceUrl: string, globalStorageUri: vscode.Uri): Promise<Agent[]>;
}

export class GitAgentSource implements IAgentSource {
    public async fetchAgents(repoUrl: string, globalStorageUri: vscode.Uri): Promise<Agent[]> {
        const gitService = new GitService();
        const baseDir = globalStorageUri.fsPath;
        const repoDirName = gitService.getRepoDirName(repoUrl);
        const destPath = path.join(baseDir, 'repos', repoDirName);

        await gitService.cloneOrPullRepo(repoUrl, destPath);

        const agentFilePaths = await this.findAgentFiles(destPath);
        const agents: Agent[] = [];

        for (const filePath of agentFilePaths) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const agent = AgentParser.parse(content, repoUrl, filePath);
                if (agent) {
                    agents.push(agent);
                }
            } catch (error) {
                console.error(`Failed to parse agent ${filePath}:`, error);
            }
        }

        return agents;
    }

    private async findAgentFiles(dir: string): Promise<string[]> {
        let results: string[] = [];
        try {
            if (!fs.existsSync(dir)) { return results; }
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== '.git') {
                        results.push(...await this.findAgentFiles(fullPath));
                    }
                } else if (entry.name.endsWith('.agent.md')) {
                    results.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
        }
        return results;
    }
}
