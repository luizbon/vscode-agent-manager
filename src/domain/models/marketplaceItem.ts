export interface IMarketplaceItem {
    id: string; // Typically repository:path or just path-based unique ID
    type: 'agent' | 'skill';
    name: string;
    description: string;
    version?: string;
    author?: string;
    tags?: string[];
    repository: string;
    path: string;
    installUrl: string;
    baseDirectory?: string; // Relative path from repo root for folder replication
}
