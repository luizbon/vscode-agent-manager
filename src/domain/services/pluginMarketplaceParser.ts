import * as path from 'path';
import * as upath from 'upath';
import { CliPlugin } from '../models/cliPlugin';
import {
    MarketplaceFile,
    MarketplacePluginEntry,
    PluginSource,
    pluginSourceToString
} from '../models/pluginMarketplace';

export class PluginMarketplaceParser {
    /**
     * Parses a marketplace.json file into CliPlugin domain objects.
     * @param marketplace       The parsed marketplace file content
     * @param repoUrl           The repository URL where the marketplace was found
     * @param marketplacePath   The relative path of marketplace.json within the repo
     * @param repoLocalPath     The absolute local path of the cloned repo root (optional)
     */
    public static parse(
        marketplace: MarketplaceFile,
        repoUrl: string,
        marketplacePath: string,
        repoLocalPath?: string
    ): CliPlugin[] {
        const pluginRoot = marketplace.metadata?.pluginRoot;
        // Directory where marketplace.json lives (relative to repo root)
        const marketplaceDir = upath.dirname(marketplacePath).replace(/^\.$/, '');
        const plugins: CliPlugin[] = [];

        for (const entry of (marketplace.plugins ?? [])) {
            const plugin = PluginMarketplaceParser.parseEntry(
                entry, repoUrl, marketplacePath, marketplaceDir, pluginRoot, repoLocalPath
            );
            if (plugin) { plugins.push(plugin); }
        }

        return plugins;
    }

    private static parseEntry(
        entry: MarketplacePluginEntry,
        repoUrl: string,
        marketplacePath: string,
        marketplaceDir: string,
        pluginRoot?: string,
        repoLocalPath?: string
    ): CliPlugin | null {
        if (!entry.name) { return null; }

        const installUrl = pluginSourceToString(entry.source, repoUrl, pluginRoot);
        const description = entry.description ?? '';
        const version = entry.version ?? '';
        const authorName = typeof entry.author === 'object'
            ? (entry.author?.name ?? '')
            : (typeof entry.author === 'string' ? entry.author : '');
        const repository = entry.repository ?? repoUrl;
        const id = `${repoUrl}::${marketplacePath}::${entry.name}`;

        // Resolve the plugin's local source directory for README discovery
        const localSourcePath = PluginMarketplaceParser.resolveLocalSourcePath(
            entry.source, marketplaceDir, pluginRoot, repoLocalPath
        );

        return new CliPlugin(
            id,
            entry.name,
            description,
            installUrl,
            repository,
            marketplacePath,
            authorName,
            version,
            entry.tags,
            localSourcePath
        );
    }

    /**
     * Resolves the absolute local path of a plugin source directory.
     * Only meaningful for relative (in-repo) sources — external sources (npm, github URL)
     * cannot be resolved locally so we return undefined for those.
     */
    private static resolveLocalSourcePath(
        source: PluginSource,
        marketplaceDir: string,
        pluginRoot?: string,
        repoLocalPath?: string
    ): string | undefined {
        if (!repoLocalPath) { return undefined; }

        if (typeof source === 'string') {
            // Relative path, e.g. "./plugins/formatter" or just "formatter"
            const stripped = source.replace(/^\.\//, '');
            const withRoot = pluginRoot
                ? upath.join(pluginRoot.replace(/^\.\//, ''), stripped)
                : stripped;
            // Paths are relative to the marketplace.json directory
            const relToMarketplace = marketplaceDir
                ? upath.join(marketplaceDir, withRoot)
                : withRoot;
            return path.resolve(repoLocalPath, relToMarketplace);
        }

        if (source.source === 'git-subdir') {
            // Attempt to resolve within the same repo if the URL matches
            return path.resolve(repoLocalPath, source.path);
        }

        // npm / github / url sources are external — no local path
        return undefined;
    }

    /**
     * Parses an ad-hoc plugin manifest JSON (fallback when no marketplace.json found).
     * @param json          The parsed JSON object
     * @param repoUrl       The repository URL
     * @param relativePath  The relative path of the JSON file within the repo
     * @param repoLocalPath     The absolute local path of the cloned repo root (optional)
     */
    public static parseAdHoc(
        json: Record<string, unknown>,
        repoUrl: string,
        relativePath: string,
        repoLocalPath?: string
    ): CliPlugin | null {
        const name = typeof json['name'] === 'string' ? json['name'] : undefined;
        if (!name) { return null; }

        const description = typeof json['description'] === 'string' ? json['description'] : '';
        const version = typeof json['version'] === 'string' ? json['version'] : '';
        const authorRaw = json['author'];
        let author = '';
        if (typeof authorRaw === 'string') {
            author = authorRaw;
        } else if (authorRaw && typeof authorRaw === 'object') {
            author = (authorRaw as Record<string, unknown>)['name'] as string ?? '';
        }

        const id = `${repoUrl}::${relativePath}`;
        // The plugin's directory is where the JSON lives
        const localSourcePath = repoLocalPath
            ? path.resolve(repoLocalPath, upath.dirname(relativePath))
            : undefined;

        return new CliPlugin(
            id,
            name,
            description,
            `${repoUrl}#${relativePath}`,
            repoUrl,
            relativePath,
            author,
            version,
            undefined,
            localSourcePath
        );
    }
}
