import { Agent } from '../domain/models/agent';
import { Skill } from '../domain/models/skill';
import { IMarketplaceSource } from './ports/marketplaceSource';

export class MarketplaceService {
    constructor(private globalStoragePath: string) { }

    public async discoverItems(repositories: string[], sourceProvider: IMarketplaceSource): Promise<{ agents: Agent[], skills: Skill[] }> {
        const result = { agents: [] as Agent[], skills: [] as Skill[] };
        for (const repo of repositories) {
            try {
                const fetched = await sourceProvider.fetchItems(repo, this.globalStoragePath);
                result.agents.push(...fetched.agents);
                result.skills.push(...fetched.skills);
            } catch (error) {
                console.error(`Error fetching items from ${repo}:`, error);
                throw error;
            }
        }
        return result;
    }

    public async fetchItemsFromRepo(repoUrl: string, sourceProvider: IMarketplaceSource): Promise<{ agents: Agent[], skills: Skill[] }> {
        return sourceProvider.fetchItems(repoUrl, this.globalStoragePath);
    }
}
