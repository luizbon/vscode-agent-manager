/**
 * Type definitions for the Claude Code plugin marketplace file format.
 * Reference: https://code.claude.com/docs/en/plugin-marketplaces
 */

export type PluginSourceRelative = string; // e.g. "./plugins/my-plugin"

export interface PluginSourceGitHub {
    source: 'github';
    repo: string;    // "owner/repo"
    ref?: string;    // branch or tag
    sha?: string;    // exact commit
}

export interface PluginSourceUrl {
    source: 'url';
    url: string;
    ref?: string;
    sha?: string;
}

export interface PluginSourceGitSubdir {
    source: 'git-subdir';
    url: string;
    path: string;
    ref?: string;
    sha?: string;
}

export interface PluginSourceNpm {
    source: 'npm';
    package: string;
    version?: string;
    registry?: string;
}

export type PluginSource =
    | PluginSourceRelative
    | PluginSourceGitHub
    | PluginSourceUrl
    | PluginSourceGitSubdir
    | PluginSourceNpm;

export interface MarketplacePluginEntry {
    /** Unique name used for installation: `/plugin install <name>@<marketplace>` */
    name: string;
    /** Where to fetch the plugin from */
    source: PluginSource;
    description?: string;
    version?: string;
    author?: { name?: string; email?: string; homepage?: string };
    repository?: string;
    license?: string;
    keywords?: string[];
    category?: string;
    tags?: string[];
    strict?: boolean;
}

export interface MarketplaceFile {
    /** Marketplace identifier */
    name: string;
    owner: { name: string; email?: string };
    metadata?: {
        description?: string;
        version?: string;
        /** Base directory prepended to relative plugin sources */
        pluginRoot?: string;
    };
    plugins: MarketplacePluginEntry[];
}

/** Determines if a JSON file is a valid marketplace file */
export function isMarketplaceFile(json: unknown): json is MarketplaceFile {
    if (!json || typeof json !== 'object') { return false; }
    const obj = json as Record<string, unknown>;
    return (
        typeof obj['name'] === 'string' &&
        obj['owner'] !== null && typeof obj['owner'] === 'object' &&
        Array.isArray(obj['plugins'])
    );
}

/** Determines if a JSON file looks like an ad-hoc plugin manifest */
export function isAdHocPluginManifest(json: unknown, fileName: string): boolean {
    if (!json || typeof json !== 'object') { return false; }
    // Skip well-known non-plugin files
    const skipFiles = ['package.json', 'tsconfig.json', 'jsconfig.json', 'composer.json', 'bower.json'];
    if (skipFiles.includes(fileName)) { return false; }

    const obj = json as Record<string, unknown>;
    const hasName = typeof obj['name'] === 'string' && (obj['name'] as string).length > 0;
    // A plugin manifest has at minimum a name and one capability indicator
    const hasCapability = (
        obj['source'] !== undefined ||
        obj['commands'] !== undefined ||
        obj['agents'] !== undefined ||
        obj['mcpServers'] !== undefined ||
        obj['lspServers'] !== undefined ||
        obj['hooks'] !== undefined ||
        (typeof obj['type'] === 'string' && ['plugin', 'cli-plugin', 'extension'].includes(obj['type'] as string))
    );
    return hasName && hasCapability;
}

/** Serialise a PluginSource to a human-readable string for display / install reference */
export function pluginSourceToString(source: PluginSource, repoUrl?: string, pluginRoot?: string): string {
    if (typeof source === 'string') {
        // Relative path — prepend pluginRoot if specified
        const base = pluginRoot ? `${pluginRoot}/${source.replace(/^\.\//, '')}` : source;
        return repoUrl ? `${repoUrl}#${base}` : base;
    }
    switch (source.source) {
        case 'github':
            return source.ref
                ? `https://github.com/${source.repo}@${source.ref}`
                : `https://github.com/${source.repo}`;
        case 'url':
            return source.ref ? `${source.url}@${source.ref}` : source.url;
        case 'git-subdir':
            return source.ref
                ? `${source.url}#${source.path}@${source.ref}`
                : `${source.url}#${source.path}`;
        case 'npm':
            return source.version
                ? `npm:${source.package}@${source.version}`
                : `npm:${source.package}`;
    }
}
