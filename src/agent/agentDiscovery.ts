import * as vscode from 'vscode';
import { IAgentSource, GitAgentSource } from './agentSources';

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

    private getSource(url: string): IAgentSource {
        // Easily extensible for new sources based on the URL format
        return new GitAgentSource();
    }

    public async searchAgents(repositories: string[]): Promise<Agent[]> {
        this.agents = [];
        for (const repo of repositories) {
            try {
                const foundAgents = await this.fetchAgentsFromRepo(repo);
                this.agents.push(...foundAgents);
            } catch (error) {
                console.error(`Error fetching agents from ${repo}:`, error);

                // Only show a notification if not running tests
                if (process.env.NODE_ENV !== 'test') {
                    vscode.window.showErrorMessage(`Failed to fetch agents from ${repo}`);
                }
            }
        }
        return this.agents;
    }

    public async fetchAgentsFromRepo(repoUrl: string): Promise<Agent[]> {
        const source = this.getSource(repoUrl);
        return source.fetchAgents(repoUrl, this.globalStorageUri);
    }
}
