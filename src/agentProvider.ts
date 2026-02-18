import * as vscode from 'vscode';
import { Agent } from './agentDiscovery';

export class AgentProvider implements vscode.TreeDataProvider<AgentTreeItem | RepositoryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | RepositoryTreeItem | undefined | null | void> = new vscode.EventEmitter<AgentTreeItem | RepositoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | RepositoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private repoAgents: Map<string, Agent[]> = new Map();

    private filterTerm: string = '';
    private filterType: 'name' | 'content' = 'name';

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

    public setFilter(term: string, type: 'name' | 'content') {
        this.filterTerm = term;
        this.filterType = type;
        vscode.commands.executeCommand('setContext', 'agentManager.filterActive', !!term);
        this._onDidChangeTreeData.fire();
    }

    get currentFilterTerm(): string {
        return this.filterTerm;
    }

    get filterStatus(): string {
        return this.filterTerm ? `Filtering by "${this.filterTerm}" (${this.filterType})` : '';
    }

    private filterAgents(agents: Agent[]): Agent[] {
        if (!this.filterTerm) {
            return agents;
        }
        const term = this.filterTerm.toLowerCase();
        return agents.filter(agent => {
            const matchName = agent.name.toLowerCase().includes(term);
            if (this.filterType === 'name') {
                return matchName;
            } else {
                // Content includes description and tags
                const matchDesc = agent.description ? agent.description.toLowerCase().includes(term) : false;
                const matchTags = agent.tags ? agent.tags.some(tag => tag.toLowerCase().includes(term)) : false;
                return matchName || matchDesc || matchTags;
            }
        });
    }

    getTreeItem(element: AgentTreeItem | RepositoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AgentTreeItem | RepositoryTreeItem): Thenable<(AgentTreeItem | RepositoryTreeItem)[]> {
        if (!element) {
            // Root: Repositories
            const repos = Array.from(this.repoAgents.keys());
            // Filter out repos that have 0 matching agents, or show them with (0)?
            // Better to show only those that have matches if a filter is active.
            const filteredRepos = repos.filter(repo => {
                const agents = this.repoAgents.get(repo) || [];
                // If filter is empty, show all. If filter is active, show only with matches.
                if (!this.filterTerm) { return true; }
                return this.filterAgents(agents).length > 0;
            });

            return Promise.resolve(filteredRepos.map(repo => {
                const agents = this.repoAgents.get(repo) || [];
                const count = this.filterAgents(agents).length;
                return new RepositoryTreeItem(repo, count);
            }));
        } else if (element instanceof RepositoryTreeItem) {
            // Children: Agents in that repo
            const agents = this.repoAgents.get(element.repoUrl) || [];
            const filtered = this.filterAgents(agents);
            return Promise.resolve(filtered.map(agent => new AgentTreeItem(agent)));
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
