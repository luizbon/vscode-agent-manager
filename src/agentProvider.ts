import * as vscode from 'vscode';
import { Agent } from './agentDiscovery';

export class AgentProvider implements vscode.TreeDataProvider<AgentTreeItem | RepositoryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | RepositoryTreeItem | undefined | null | void> = new vscode.EventEmitter<AgentTreeItem | RepositoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | RepositoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private repoAgents: Map<string, Agent[]> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.loadCache();
    }

    private loadCache() {
        const cache = this.context.globalState.get<any>('agentManager.cache');
        if (cache) {
            for (const repo in cache) {
                this.repoAgents.set(repo, cache[repo]);
            }
            this._onDidChangeTreeData.fire();
        }
    }

    public saveCache() {
        const cache: any = {};
        for (const [repo, agents] of this.repoAgents) {
            cache[repo] = agents;
        }
        this.context.globalState.update('agentManager.cache', cache);
    }

    clear() {
        this.repoAgents.clear();
        this._onDidChangeTreeData.fire();
    }

    prune(validRepos: string[]) {
        for (const repo of this.repoAgents.keys()) {
            if (!validRepos.includes(repo)) {
                this.repoAgents.delete(repo);
            }
        }
        this._onDidChangeTreeData.fire();
    }

    addAgents(repo: string, agents: Agent[]) {
        this.repoAgents.set(repo, agents);
        this._onDidChangeTreeData.fire();
        this.saveCache();
    }

    get isEmpty(): boolean {
        return this.repoAgents.size === 0;
    }

    getTreeItem(element: AgentTreeItem | RepositoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AgentTreeItem | RepositoryTreeItem): Thenable<(AgentTreeItem | RepositoryTreeItem)[]> {
        if (!element) {
            // Root: Repositories
            const repos = Array.from(this.repoAgents.keys());
            return Promise.resolve(repos.map(repo => new RepositoryTreeItem(repo, this.repoAgents.get(repo)?.length || 0)));
        } else if (element instanceof RepositoryTreeItem) {
            // Children: Agents in that repo
            const agents = this.repoAgents.get(element.repoUrl) || [];
            return Promise.resolve(agents.map(agent => new AgentTreeItem(agent)));
        } else {
            return Promise.resolve([]);
        }
    }
}

export class RepositoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly repoUrl: string,
        public readonly count: number
    ) {
        super(repoUrl.split('/').slice(-2).join('/'), vscode.TreeItemCollapsibleState.Expanded);
        this.tooltip = repoUrl;
        this.description = `(${count})`;
        this.contextValue = 'repository';
        this.iconPath = new vscode.ThemeIcon('repo');
    }
}

export class AgentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly agent: Agent
    ) {
        super(agent.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${this.agent.name}\n${this.agent.description}`;
        this.description = agent.version;
        this.contextValue = 'agent';
        this.iconPath = new vscode.ThemeIcon('hubot'); // Robot icon for agents
        this.command = {
            command: 'agentManager.openAgentDetails',
            title: 'Open Agent Details',
            arguments: [this.agent]
        };
    }
}
