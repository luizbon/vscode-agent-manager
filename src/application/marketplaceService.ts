import { Agent } from '../domain/models/agent';
import { Skill } from '../domain/models/skill';
import { CliPlugin } from '../domain/models/cliPlugin';
import { IMarketplaceSource, FetchMode } from './ports/marketplaceSource';

export class MarketplaceService {
    constructor(private globalStoragePath: string) { }

    public async discoverItems(repositories: string[], sourceProvider: IMarketplaceSource): Promise<{ agents: Agent[], skills: Skill[], cliPlugins: CliPlugin[] }> {
        const result = { agents: [] as Agent[], skills: [] as Skill[], cliPlugins: [] as CliPlugin[] };
        for (const repo of repositories) {
            try {
                const fetched = await sourceProvider.fetchItems(repo, this.globalStoragePath);
                result.agents.push(...fetched.agents);
                result.skills.push(...fetched.skills);
                if (fetched.cliPlugins) {
                    result.cliPlugins.push(...fetched.cliPlugins);
                }
            } catch (error) {
                console.error(`Error fetching items from ${repo}:`, error);
                throw error;
            }
        }
        return result;
    }

    public async fetchItemsFromRepo(
        repoUrl: string,
        sourceProvider: IMarketplaceSource,
        mode: FetchMode = 'agent'
    ): Promise<{ agents: Agent[], skills: Skill[], cliPlugins?: CliPlugin[] }> {
        return sourceProvider.fetchItems(repoUrl, this.globalStoragePath, mode);
    }
}
