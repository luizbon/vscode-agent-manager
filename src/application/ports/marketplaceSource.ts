import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';

export interface IMarketplaceSource {
    fetchItems(sourceUrl: string, globalStoragePath: string): Promise<{ agents: Agent[], skills: Skill[] }>;
}
