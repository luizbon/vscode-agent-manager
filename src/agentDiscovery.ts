import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

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

    constructor() { }

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
        // Assume GitHub repo for now.
        // Transform URL to API URL or raw content URL
        // Example: https://github.com/github-copilot-resources/awesome-copilot-agents
        // API: https://api.github.com/repos/github-copilot-resources/awesome-copilot-agents/contents/

        // Naive implementation: fetch repo contents, recurse or look for .agent.md
        // For "awesome" lists, we might need a specific structure or just crawl.
        // Let's assume a structure where agents are in folders or we scan the repo.

        // Better approach for the hackathon/MVP: 
        // 1. Use GitHub API to list files recursively (tree).
        // 2. Filter for .agent.md

        const ownerRepo = this.parseGitHubUrl(repoUrl);
        if (!ownerRepo) {
            throw new Error('Invalid GitHub URL');
        }

        const { owner, repo } = ownerRepo;
        const tree = await this.fetchGitHubTree(owner, repo);

        const agentFiles = tree.filter((item: any) => item.path.endsWith('.agent.md'));
        const agents: Agent[] = [];

        for (const file of agentFiles) {
            try {
                const content = await this.fetchGitHubFileContent(owner, repo, file.path);
                const agent = this.parseAgentFile(content, repoUrl, file.path);
                if (agent) {
                    agents.push(agent);
                }
            } catch (error) {
                console.error(`Failed to parse agent ${file.path}:`, error);
            }
        }

        return agents;
    }

    public parseGitHubUrl(url: string): { owner: string, repo: string } | null {
        // support https://github.com/OWNER/REPO
        const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (match) {
            return { owner: match[1], repo: match[2].replace('.git', '') };
        }
        return null;
    }

    private async fetchGitHubTree(owner: string, repo: string): Promise<any[]> {
        // https://api.github.com/repos/OWNER/REPO/git/trees/main?recursive=1 
        // Need to identify default branch first preferably, or assume main/master.
        // Let's try main, then master.

        const branches = ['main', 'master'];
        for (const branch of branches) {
            try {
                const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
                const response = await this.httpsGetBlocking(url);
                const data = JSON.parse(response);
                if (data.tree) {
                    return data.tree;
                }
            } catch (e) {
                // ignore and try next branch
            }
        }
        return [];
    }

    private async fetchGitHubFileContent(owner: string, repo: string, filePath: string): Promise<string> {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${filePath}`;
        return await this.httpsGetBlocking(url);
    }

    private httpsGetBlocking(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'VSCode-Agent-Manager'
                }
            };
            https.get(url, options, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Request failed with status code ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', (err) => reject(err));
        });
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

        // Fallback or additional parsing from body if needed
        // For now rely on frontmatter or basic inference

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
            installUrl: `https://raw.githubusercontent.com/${this.parseGitHubUrl(repo)?.owner}/${this.parseGitHubUrl(repo)?.repo}/HEAD/${filePath}` // heuristic
        };
    }
}
