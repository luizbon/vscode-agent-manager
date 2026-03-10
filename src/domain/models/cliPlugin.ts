import { IMarketplaceItem } from './marketplaceItem';

export class CliPlugin implements IMarketplaceItem {
    public readonly type = 'cli-plugin';

    constructor(
        public readonly id: string,             // typically `repository:path` or just the `repository`
        public readonly name: string,
        public readonly description: string,
        public readonly installUrl: string,     // typically the `owner/repo:path` that can be passed to Copilot CLI
        public readonly repository: string,
        public readonly path: string,
        public readonly author?: string,
        public readonly version?: string,
        public readonly tags?: string[],
        /** Absolute local filesystem path to the plugin's source directory (set after cloning) */
        public readonly localSourcePath?: string
    ) { }
}
