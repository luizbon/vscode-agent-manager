import * as vscode from 'vscode';
import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';
import { CliPlugin } from '../../domain/models/cliPlugin';

export class MarketplaceTreeProvider implements vscode.TreeDataProvider<RegistryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RegistryItem | undefined | null | void> = new vscode.EventEmitter<RegistryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RegistryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private repoAgents: Map<string, { agents: Agent[], skills: Skill[], cliPlugins: CliPlugin[], timestamp: number }> = new Map();
    private pluginSourceRepos: Map<string, { cliPlugins: CliPlugin[], timestamp: number }> = new Map();
    private installedAgents: Agent[] = [];
    private installedSkills: Skill[] = [];
    private installedCliPlugins: CliPlugin[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.loadCache();
    }

    // Version this cache so schema changes (like baseDirectory logic) auto-invalidate old entries
    private static readonly CACHE_VERSION = 4;

    private loadCache() {
        const cacheVersion = this.context.globalState.get<number>('marketplace.cache.version');
        if (cacheVersion !== MarketplaceTreeProvider.CACHE_VERSION) {
            // Cache is from an older version - discard it to force a fresh fetch
            this.context.globalState.update('marketplace.cache', undefined);
            this.context.globalState.update('marketplace.cache.version', MarketplaceTreeProvider.CACHE_VERSION);
            return;
        }

        const cache = this.context.globalState.get<any>('marketplace.cache');
        if (cache) {
            // Load agent repos
            const agentRepos = cache.repos || cache; // Support migration from old format
            for (const repo in agentRepos) {
                if (agentRepos[repo] && agentRepos[repo].agents && Array.isArray(agentRepos[repo].agents)) {
                    this.repoAgents.set(repo, {
                        agents: agentRepos[repo].agents || [],
                        skills: agentRepos[repo].skills || [],
                        cliPlugins: agentRepos[repo].cliPlugins || [],
                        timestamp: agentRepos[repo].timestamp || 0
                    });
                }
            }
            // Load plugin sources
            const pluginRepos = cache.pluginSources;
            if (pluginRepos) {
                for (const repo in pluginRepos) {
                    this.pluginSourceRepos.set(repo, {
                        cliPlugins: pluginRepos[repo].cliPlugins || [],
                        timestamp: pluginRepos[repo].timestamp || 0
                    });
                }
            }
        }
    }

    public saveCache() {
        const repos: any = {};
        for (const [repo, data] of this.repoAgents) {
            repos[repo] = data;
        }
        const pluginSources: any = {};
        for (const [repo, data] of this.pluginSourceRepos) {
            pluginSources[repo] = data;
        }

        this.context.globalState.update('marketplace.cache', { repos, pluginSources });
        this.context.globalState.update('marketplace.cache.version', MarketplaceTreeProvider.CACHE_VERSION);
    }

    clear() {
        this.repoAgents.clear();
        this.pluginSourceRepos.clear();
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

    pruneCliPluginSources(validSources: string[]) {
        for (const repo of this.pluginSourceRepos.keys()) {
            if (!validSources.includes(repo)) {
                this.pluginSourceRepos.delete(repo);
            }
        }
        this._onDidChangeTreeData.fire();
    }

    addItems(repo: string, agents: Agent[], skills: Skill[], cliPlugins: CliPlugin[] = []) {
        this.repoAgents.set(repo, { agents, skills, cliPlugins, timestamp: Date.now() });
        this._onDidChangeTreeData.fire();
        this.saveCache();
    }

    addCliPluginItems(repo: string, cliPlugins: CliPlugin[]) {
        this.pluginSourceRepos.set(repo, { cliPlugins, timestamp: Date.now() });
        this._onDidChangeTreeData.fire();
        this.saveCache();
    }

    get isEmpty(): boolean {
        return this.repoAgents.size === 0 && this.pluginSourceRepos.size === 0;
    }

    public isCliPluginCacheValid(repo: string): boolean {
        const data = this.pluginSourceRepos.get(repo);
        if (!data) { return false; }
        const config = vscode.workspace.getConfiguration('agentManager');
        const days = config.get<number>('cacheDurationDays') || 7;
        return (Date.now() - data.timestamp) < (days * 24 * 60 * 60 * 1000);
    }

    public isCacheValid(repo: string): boolean {
        const data = this.repoAgents.get(repo);
        if (!data) { return false; }

        const config = vscode.workspace.getConfiguration('agentManager');
        const days = config.get<number>('cacheDurationDays') || 7;
        const durationMs = days * 24 * 60 * 60 * 1000;

        return (Date.now() - data.timestamp) < durationMs;
    }

    public getAllCachedItems(): { agents: Agent[], skills: Skill[], cliPlugins: CliPlugin[] } {
        const agents: Agent[] = [];
        const skills: Skill[] = [];
        const cliPlugins: CliPlugin[] = [];
        for (const data of this.repoAgents.values()) {
            agents.push(...data.agents);
            skills.push(...data.skills);
            cliPlugins.push(...data.cliPlugins);
        }
        for (const data of this.pluginSourceRepos.values()) {
            cliPlugins.push(...data.cliPlugins);
        }
        return { agents, skills, cliPlugins };
    }

    public getInstalledItems(): { agents: Agent[], skills: Skill[], cliPlugins: CliPlugin[] } {
        return { agents: this.installedAgents, skills: this.installedSkills, cliPlugins: this.installedCliPlugins };
    }

    public setInstalledItems(agents: Agent[], skills: Skill[], cliPlugins?: CliPlugin[]) {
        this.installedAgents = agents;
        this.installedSkills = skills;
        if (cliPlugins) {
            this.installedCliPlugins = cliPlugins;
        }
        this._onDidChangeTreeData.fire();
    }

    private checkUpdateAvailable(installedItem: Agent | Skill | CliPlugin): (Agent | Skill | CliPlugin) | undefined {
        for (const [repo, data] of this.repoAgents) {
            const list = installedItem.type === 'agent' ? data.agents : (installedItem.type === 'skill' ? data.skills : data.cliPlugins);
            // @ts-ignore
            const found = list.find(a => a.name === installedItem.name); // Simple match by name
            if (found) {
                if (found.version && installedItem.version && found.version !== installedItem.version) {
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
                new CategoryItem('Installed Agents', 'installed_agents', vscode.TreeItemCollapsibleState.Expanded),
                new CategoryItem('Installed Skills', 'installed_skills', vscode.TreeItemCollapsibleState.Expanded),
                new CategoryItem('Installed CLI Plugins', 'installed_cli_plugins', vscode.TreeItemCollapsibleState.Expanded),
                new CategoryItem('Sources', 'sources', vscode.TreeItemCollapsibleState.Expanded)
            ]);
        } else if (element instanceof CategoryItem) {
            if (element.id === 'installed_agents') {
                if (this.installedAgents.length === 0) {
                    return Promise.resolve([new vscode.TreeItem('No installed agents', vscode.TreeItemCollapsibleState.None) as any as RegistryItem]);
                }
                return Promise.resolve(this.installedAgents.map(a => {
                    const updateItem = this.checkUpdateAvailable(a);
                    return new MarketplaceTreeItem(a, true, updateItem);
                }));
            } else if (element.id === 'installed_skills') {
                if (this.installedSkills.length === 0) {
                    return Promise.resolve([new vscode.TreeItem('No installed skills', vscode.TreeItemCollapsibleState.None) as any as RegistryItem]);
                }
                return Promise.resolve(this.installedSkills.map(s => {
                    const updateItem = this.checkUpdateAvailable(s);
                    return new MarketplaceTreeItem(s, true, updateItem);
                }));
            } else if (element.id === 'installed_cli_plugins') {
                if (this.installedCliPlugins.length === 0) {
                    return Promise.resolve([new vscode.TreeItem('No installed CLI plugins', vscode.TreeItemCollapsibleState.None) as any as RegistryItem]);
                }
                return Promise.resolve(this.installedCliPlugins.map(p => {
                    const updateItem = this.checkUpdateAvailable(p);
                    return new MarketplaceTreeItem(p, true, updateItem);
                }));
            } else if (element.id === 'sources') {
                const agentRepoItems = Array.from(this.repoAgents.keys()).map(repo => {
                    const data = this.repoAgents.get(repo);
                    const count = data ? data.agents.length + data.skills.length + data.cliPlugins.length : 0;
                    return new RepositoryTreeItem(repo, count, 'agent-source');
                });
                // Only show plugin source entries for repos NOT already shown as agent repos
                const agentRepoKeys = new Set(this.repoAgents.keys());
                const pluginRepoItems = Array.from(this.pluginSourceRepos.keys())
                    .filter(repo => !agentRepoKeys.has(repo))
                    .map(repo => {
                        const data = this.pluginSourceRepos.get(repo);
                        const count = data ? data.cliPlugins.length : 0;
                        return new RepositoryTreeItem(repo, count, 'plugin-source');
                    });
                return Promise.resolve([...agentRepoItems, ...pluginRepoItems]);
            }
        } else if (element instanceof RepositoryTreeItem) {
            const items: (Agent | Skill | CliPlugin)[] = [];
            const agentData = this.repoAgents.get(element.repoUrl);
            if (agentData) {
                items.push(...agentData.agents);
                items.push(...agentData.skills);
                items.push(...agentData.cliPlugins);
            }
            const pluginData = this.pluginSourceRepos.get(element.repoUrl);
            if (pluginData) {
                items.push(...pluginData.cliPlugins);
            }
            return Promise.resolve(items.map(item => new MarketplaceTreeItem(item, false)));
        }

        return Promise.resolve([]);
    }
}

export type RegistryItem = CategoryItem | RepositoryTreeItem | MarketplaceTreeItem;

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly id: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.contextValue = 'category';
        if (id === 'installed_agents') { this.iconPath = new vscode.ThemeIcon('hubot'); }
        if (id === 'installed_skills') { this.iconPath = new vscode.ThemeIcon('symbol-misc'); }
        if (id === 'installed_cli_plugins') { this.iconPath = new vscode.ThemeIcon('plug'); }
        if (id === 'sources') { this.iconPath = new vscode.ThemeIcon('rss'); }
    }
}

export class RepositoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly repoUrl: string,
        public readonly count: number,
        public readonly sourceType: 'agent-source' | 'plugin-source' = 'agent-source'
    ) {
        super(repoUrl.split('/').slice(-2).join('/'), vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = repoUrl;
        this.description = `(${count} ${sourceType === 'plugin-source' ? 'plugins' : 'items'})`;
        this.contextValue = 'repository';
        this.iconPath = new vscode.ThemeIcon(sourceType === 'plugin-source' ? 'plug' : 'repo');
    }
}

export class MarketplaceTreeItem extends vscode.TreeItem {
    public readonly item: Agent | Skill | CliPlugin;

    constructor(
        item: Agent | Skill | CliPlugin,
        public readonly installed: boolean,
        public readonly updateItem?: Agent | Skill | CliPlugin
    ) {
        super(item.name, vscode.TreeItemCollapsibleState.None);
        this.item = item;
        this.tooltip = `${item.name}\n${item.description}`;

        let desc = item.version || '';
        const prefix = item.type === 'agent' ? 'agent' : (item.type === 'skill' ? 'skill' : 'cliPlugin');

        if (installed) {
            if (updateItem && updateItem.version) {
                desc += ` (Update available: ${updateItem.version})`;
                this.contextValue = `${prefix}:installed:outdated`;
            } else {
                this.contextValue = `${prefix}:installed`;
            }
        } else {
            this.contextValue = `${prefix}:available`;
        }

        if (installed) {
            if (item.repository === 'Global') {
                this.iconPath = new vscode.ThemeIcon('globe');
            } else if (item.type === 'cli-plugin') {
                this.iconPath = new vscode.ThemeIcon('plug');
            } else {
                this.iconPath = new vscode.ThemeIcon('file-directory');
            }
        } else {
            this.iconPath = new vscode.ThemeIcon(item.type === 'agent' ? 'hubot' : (item.type === 'skill' ? 'symbol-misc' : 'plug'));
        }

        this.description = desc;

        if (installed && item.path && item.type !== 'cli-plugin') {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(item.path)]
            };
        } else {
            this.command = {
                command: 'marketplace.openDetails',
                title: 'Open Details',
                arguments: [item]
            };
        }
    }
}
