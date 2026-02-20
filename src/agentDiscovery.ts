import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitService } from './gitService';

export interface Agent {
    name: string;
    description: string;
    version?: string;
    author?: string;
    tags?: string[];
    repository: string;
    path: string;
    installUrl: string;
}

export class AgentDiscovery {
    private agents: Agent[] = [];

    constructor(private globalStorageUri: vscode.Uri) { }

    public async searchAgents(repositories: string[]): Promise<Agent[]> {
        this.agents = [];
        for (const repo of repositories) {
            try {
                const foundAgents = await this.fetchAgentsFromRepo(repo);
                this.agents.push(...foundAgents);
            } catch (error) {
                console.error(`Error fetching agents from ${repo}:`, error);
                vscode.window.showErrorMessage(`Failed to fetch agents from ${repo}`);
            }
        }
        return this.agents;
    }

    public async fetchAgentsFromRepo(repoUrl: string): Promise<Agent[]> {
        const gitService = new GitService();
        const baseDir = this.globalStorageUri.fsPath;
        const repoDirName = gitService.getRepoDirName(repoUrl);
        const destPath = path.join(baseDir, 'repos', repoDirName);

        await gitService.cloneOrPullRepo(repoUrl, destPath);

        const agentFilePaths = await this.findAgentFiles(destPath);
        const agents: Agent[] = [];

        for (const filePath of agentFilePaths) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const agent = this.parseAgentFile(content, repoUrl, filePath);
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

    private parseAgentFile(content: string, repo: string, filePath: string): Agent | null {
        // Parse frontmatter or headers
        // Simple frontmatter parser
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(frontmatterRegex);

        let metadata: any = {};
        if (match) {
            const yaml = match[1];
            yaml.split('\n').forEach(line => {
                const [keyRaw, ...valueParts] = line.split(':');
                if (keyRaw && valueParts.length > 0) {
                    // Handle commented keys like "# version"
                    const key = keyRaw.replace(/^#\s*/, '').trim();
                    metadata[key] = valueParts.join(':').trim();
                }
            });
        }

        // Additional parsing: Look for HTML comments with metadata (e.g., <!-- version: 1.0.0 --> or <!-- version 1.0.0 -->)
        const commentRegex = /<!--\s*(\w+)(?::|\s)\s*(.*?)\s*-->/g;
        let commentMatch;
        while ((commentMatch = commentRegex.exec(content)) !== null) {
            const key = commentMatch[1].toLowerCase();
            const value = commentMatch[2].trim();
            // Only override if not present in frontmatter
            if (!metadata[key]) {
                metadata[key] = value;
            }
        }

        if (!metadata.name) {
            // infer from filename
            metadata.name = path.basename(filePath, '.agent.md');
        }

        // Clean up name (remove quotes)
        let name = metadata.name;
        // Iteratively remove quotes if they are wrapped multiple times or just to be safe
        name = name.replace(/^['"]+|['"]+$/g, '');
        name = name.trim();

        return {
            name: name,
            description: metadata.description || 'No description provided.',
            version: metadata.version,
            author: metadata.author,
            tags: metadata.tags ? metadata.tags.split(',').map((t: string) => t.trim()) : [],
            repository: repo,
            path: filePath,
            installUrl: filePath
        };
    }
}
