import { Agent } from '../../domain/models/agent';
import { Skill } from '../../domain/models/skill';
import { CliPlugin } from '../../domain/models/cliPlugin';

export type FetchMode = 'agent' | 'plugin';

export interface IMarketplaceSource {
    fetchItems(sourceUrl: string, globalStoragePath: string, mode?: FetchMode): Promise<{ agents: Agent[], skills: Skill[], cliPlugins?: CliPlugin[] }>;
}
