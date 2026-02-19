import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Agent, AgentDiscovery } from './agentDiscovery';

export class AgentProvider implements vscode.TreeDataProvider<RegistryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RegistryItem | undefined | null | void> = new vscode.EventEmitter<RegistryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RegistryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private repoAgents: Map<string, { agents: Agent[], timestamp: number }> = new Map();
    private installedAgents: Agent[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.loadCache();
        this.refreshInstalledAgents();
    }

    private loadCache() {
        const cache = this.context.globalState.get<any>('agentManager.cache');
        if (cache) {
            for (const repo in cache) {
                // Compatibility check: if cache[repo] is array (old format), wrap it
                if (Array.isArray(cache[repo])) {
                    this.repoAgents.set(repo, { agents: cache[repo], timestamp: 0 }); // 0 means expired/old
                } else {
                    this.repoAgents.set(repo, cache[repo]);
                }
            }
        }
    }

    public saveCache() {
        const cache: any = {};
        for (const [repo, data] of this.repoAgents) {
            cache[repo] = data;
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
        this.repoAgents.set(repo, { agents, timestamp: Date.now() });
        this._onDidChangeTreeData.fire();
        this.saveCache();
    }

    get isEmpty(): boolean {
        return this.repoAgents.size === 0;
    }

    public isCacheValid(repo: string): boolean {
        const data = this.repoAgents.get(repo);
        if (!data) { return false; }

        const config = vscode.workspace.getConfiguration('agentManager');
        const days = config.get<number>('cacheDurationDays') || 7;
        const durationMs = days * 24 * 60 * 60 * 1000;

        return (Date.now() - data.timestamp) < durationMs;
    }

    public getAgentsFromCache(repo: string): Agent[] {
        return this.repoAgents.get(repo)?.agents || [];
    }

    public getAllCachedAgents(): Agent[] {
        const all: Agent[] = [];
        for (const data of this.repoAgents.values()) {
            all.push(...data.agents);
        }
        return all;
    }

    public getInstalledAgents(): Agent[] {
        return this.installedAgents;
    }

    async refreshInstalledAgents() {
        const newInstalledAgents: Agent[] = [];

        // 1. Scan Workspace
        if (vscode.workspace.workspaceFolders) {
            const files = await vscode.workspace.findFiles('**/*.agent.md', '**/node_modules/**');
            for (const file of files) {
                try {
                    const content = await vscode.workspace.fs.readFile(file);
                    // Use fsPath for local parsing
                    const agent = this.parseLocalAgent(content.toString(), file.fsPath);
                    if (agent) {
                        agent.repository = 'Workspace'; // Mark as Workspace
                        agent.path = file.fsPath; // Ensure path is string
                        newInstalledAgents.push(agent);
                    }
                } catch (e) {
                    console.error('Error reading installed agent:', e);
                }
            }
        }

        // 2. Scan Global storage
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        const userDir = path.dirname(path.dirname(globalStoragePath));
        const userPath = path.join(userDir, 'prompts');

        if (fs.existsSync(userPath)) {
            try {
                // simple recursive or flat scan of global prompts dir
                const globalFiles = fs.readdirSync(userPath).filter(f => f.endsWith('.agent.md'));
                for (const file of globalFiles) {
                    const fullPath = path.join(userPath, file);
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const agent = this.parseLocalAgent(content, fullPath);
                    if (agent) {
                        agent.repository = 'Global'; // Mark as Global
                        agent.path = fullPath;
                        newInstalledAgents.push(agent);
                    }
                }
            } catch (e) {
                console.error('Error scanning global agents:', e);
            }
        }

        this.installedAgents = newInstalledAgents;
        this._onDidChangeTreeData.fire();
    }

    // Re-use parsing logic (simplified) or move parsing to a shared utility
    private parseLocalAgent(content: string, filePath: string): Agent | null {
        // Re-implementing a simple parser or we should export parseAgentFile from AgentDiscovery 
        // For now, simple extraction
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(frontmatterRegex);

        let name = path.basename(filePath, '.agent.md');
        let description = '';
        let version = '';

        if (match) {
            const yaml = match[1];
            const nameMatch = yaml.match(/^name:\s*(.*)$/m);
            if (nameMatch) { name = nameMatch[1].trim().replace(/^['"]+|['"]+$/g, ''); }

            const descMatch = yaml.match(/^description:\s*(.*)$/m);
            if (descMatch) { description = descMatch[1].trim(); }

            const verMatch = yaml.match(/^version:\s*(.*)$/m);
            if (verMatch) { version = verMatch[1].trim(); }
        }

        return {
            name,
            description,
            version,
            path: filePath,
            repository: 'Local',
            installUrl: filePath
        };
    }

    private checkUpdateAvailable(installedAgent: Agent): Agent | undefined {
        for (const [repo, data] of this.repoAgents) {
            const found = data.agents.find(a => a.name === installedAgent.name); // Simple match by name
            if (found) {
                // simple string comparison for version, ideally semver
                if (found.version && installedAgent.version && found.version !== installedAgent.version) {
                    return found;
                }
            }
        }
        return undefined;
    }

    getTreeItem(element: RegistryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RegistryItem): Thenable<RegistryItem[]> {
        if (!element) {
            // Root
            return Promise.resolve([
                new CategoryItem('Installed Agents', 'installed', vscode.TreeItemCollapsibleState.Expanded),
                new CategoryItem('Sources', 'sources', vscode.TreeItemCollapsibleState.Expanded)
            ]);
        } else if (element instanceof CategoryItem) {
            if (element.id === 'installed') {
                if (this.installedAgents.length === 0) {
                    return Promise.resolve([new vscode.TreeItem('No installed agents', vscode.TreeItemCollapsibleState.None) as any as RegistryItem]);
                }
                return Promise.resolve(this.installedAgents.map(a => {
                    const updateAgent = this.checkUpdateAvailable(a);
                    return new AgentTreeItem(a, true, updateAgent);
                }));
            } else if (element.id === 'sources') {
                const repos = Array.from(this.repoAgents.keys());
                return Promise.resolve(repos.map(repo => {
                    const data = this.repoAgents.get(repo);
                    const count = data ? data.agents.length : 0;
                    return new RepositoryTreeItem(repo, count);
                }));
            }
        } else if (element instanceof RepositoryTreeItem) {
            // If we want to show agents under sources too? 
            // The prompt says "The list of repositories and an expandable tree should also be in the lower panel"
            // But existing behavior was showing agents inside repos. 
            // Let's keep it but maybe collapsed.
            const data = this.repoAgents.get(element.repoUrl);
            const agents = data ? data.agents : [];
            return Promise.resolve(agents.map(agent => new AgentTreeItem(agent, false)));
        }

        return Promise.resolve([]);
    }
}

export type RegistryItem = CategoryItem | RepositoryTreeItem | AgentTreeItem;

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly id: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.contextValue = 'category';
        if (id === 'profiles') { this.iconPath = new vscode.ThemeIcon('home'); }
        if (id === 'installed') { this.iconPath = new vscode.ThemeIcon('package'); }
        if (id === 'sources') { this.iconPath = new vscode.ThemeIcon('rss'); }
    }
}

export class RepositoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly repoUrl: string,
        public readonly count: number
    ) {
        super(repoUrl.split('/').slice(-2).join('/'), vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = repoUrl;
        this.description = `(${count})`;
        this.contextValue = 'repository';
        this.iconPath = new vscode.ThemeIcon('repo');
    }
}

export class AgentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly agent: Agent,
        public readonly installed: boolean,
        public readonly updateAgent?: Agent
    ) {
        super(agent.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${this.agent.name}\n${this.agent.description}`;

        let desc = agent.version;
        if (installed) {
            if (updateAgent && updateAgent.version) {
                desc += ` (Update available: ${updateAgent.version})`;
                this.contextValue = 'agent:installed:outdated';
            } else {
                this.contextValue = 'agent:installed';
            }
        } else {
            this.contextValue = 'agent:available';
        }

        if (installed) {
            if (agent.repository === 'Global') {
                this.iconPath = new vscode.ThemeIcon('globe');
            } else {
                this.iconPath = new vscode.ThemeIcon('file-directory'); // or 'folder'
            }
        } else {
            this.iconPath = new vscode.ThemeIcon('hubot');
        }

        this.description = desc;

        if (installed && this.agent.path) {
            this.command = {
                command: 'vscode.open',
                title: 'Open Agent File',
                arguments: [vscode.Uri.file(this.agent.path)]
            };
        } else {
            this.command = {
                command: 'agentManager.openAgentDetails',
                title: 'Open Agent Details',
                arguments: [this.agent]
            };
        }
    }
}
