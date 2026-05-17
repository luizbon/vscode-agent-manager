import * as vscode from 'vscode';
import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';

export class MarketplaceTreeProvider implements vscode.TreeDataProvider<RegistryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RegistryItem | undefined | null | void> = new vscode.EventEmitter<RegistryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RegistryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private repoAgents: Map<string, { agents: Agent[], skills: Skill[], timestamp: number }> = new Map();
    private installedAgents: Agent[] = [];
    private installedSkills: Skill[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.loadCache();
    }

    // Version this cache so schema changes (like baseDirectory logic) auto-invalidate old entries
    private static readonly CACHE_VERSION = 2;

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
            for (const repo in cache) {
                // Ensure backward compatibility or skip if old format
                if (cache[repo] && cache[repo].agents && Array.isArray(cache[repo].agents)) {
                    this.repoAgents.set(repo, {
                        agents: cache[repo].agents || [],
                        skills: cache[repo].skills || [],
                        timestamp: cache[repo].timestamp || 0
                    });
                }
            }
        }
    }

    public saveCache() {
        const cache: any = {};
        for (const [repo, data] of this.repoAgents) {
            cache[repo] = data;
        }
        this.context.globalState.update('marketplace.cache', cache);
        this.context.globalState.update('marketplace.cache.version', MarketplaceTreeProvider.CACHE_VERSION);
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

    addItems(repo: string, agents: Agent[], skills: Skill[]) {
        this.repoAgents.set(repo, { agents, skills, timestamp: Date.now() });
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

    public getAllCachedItems(): { agents: Agent[], skills: Skill[] } {
        const agents: Agent[] = [];
        const skills: Skill[] = [];
        for (const data of this.repoAgents.values()) {
            agents.push(...data.agents);
            skills.push(...data.skills);
        }
        return { agents, skills };
    }

    public getInstalledItems(): { agents: Agent[], skills: Skill[] } {
        return { agents: this.installedAgents, skills: this.installedSkills };
    }

    public setInstalledItems(agents: Agent[], skills: Skill[]) {
        this.installedAgents = agents;
        this.installedSkills = skills;
        this._onDidChangeTreeData.fire();
    }

    private checkUpdateAvailable(installedItem: Agent | Skill): (Agent | Skill) | undefined {
        for (const [repo, data] of this.repoAgents) {
            const list = installedItem.type === 'agent' ? data.agents : data.skills;
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
            // Root - directly list repositories as top-level nodes
            const repos = Array.from(this.repoAgents.keys());
            return Promise.resolve(repos.map(repo => {
                const data = this.repoAgents.get(repo);
                const count = data ? data.agents.length + data.skills.length : 0;
                return new RepositoryTreeItem(repo, count);
            }));
        } else if (element instanceof RepositoryTreeItem) {
            const data = this.repoAgents.get(element.repoUrl);
            const items: (Agent | Skill)[] = [];
            if (data) {
                items.push(...data.agents);
                items.push(...data.skills);
            }
            return Promise.resolve(items.map(item => new MarketplaceTreeItem(item, false)));
        }

        return Promise.resolve([]);
    }
}

export type RegistryItem = RepositoryTreeItem | MarketplaceTreeItem;

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

export class MarketplaceTreeItem extends vscode.TreeItem {
    public readonly item: Agent | Skill;

    constructor(
        item: Agent | Skill,
        public readonly installed: boolean,
        public readonly updateItem?: Agent | Skill
    ) {
        super(item.name, vscode.TreeItemCollapsibleState.None);
        this.item = item;
        this.tooltip = `${item.name}\n${item.description}`;

        let desc = item.version;
        const prefix = item.type === 'agent' ? 'agent' : 'skill';

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
            } else {
                this.iconPath = new vscode.ThemeIcon('file-directory');
            }
        } else {
            this.iconPath = new vscode.ThemeIcon(item.type === 'agent' ? 'hubot' : 'symbol-misc');
        }

        this.description = desc;

        if (installed && item.path) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(item.path)]
            };
        } else {
            this.command = {
                command: 'marketplace.install',
                title: 'Install Item',
                arguments: [item]
            };
        }
    }
}
