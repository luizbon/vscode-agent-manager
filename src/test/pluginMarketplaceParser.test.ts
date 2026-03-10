import * as assert from 'assert';
import { PluginMarketplaceParser } from '../domain/services/pluginMarketplaceParser';
import { MarketplaceFile } from '../domain/models/pluginMarketplace';

suite('PluginMarketplaceParser', () => {
    const repoUrl = 'https://github.com/example/plugins';
    const marketplacePath = '.claude-plugin/marketplace.json';

    test('parses plugins with relative path sources', () => {
        const marketplace: MarketplaceFile = {
            name: 'my-plugins',
            owner: { name: 'DevTools Team' },
            plugins: [
                {
                    name: 'formatter',
                    source: './plugins/formatter',
                    description: 'Auto code formatter',
                    version: '1.0.0',
                    author: { name: 'DevTools' }
                }
            ]
        };

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 1);
        assert.strictEqual(plugins[0].name, 'formatter');
        assert.strictEqual(plugins[0].description, 'Auto code formatter');
        assert.strictEqual(plugins[0].version, '1.0.0');
        assert.strictEqual(plugins[0].author, 'DevTools');
        assert.ok(plugins[0].installUrl.includes('plugins/formatter'));
        assert.strictEqual(plugins[0].repository, repoUrl);
    });

    test('parses plugins with github source', () => {
        const marketplace: MarketplaceFile = {
            name: 'hub',
            owner: { name: 'ACME' },
            plugins: [
                {
                    name: 'deploy-tools',
                    source: { source: 'github', repo: 'acme/deploy-plugin', ref: 'v2.0.0' }
                }
            ]
        };

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 1);
        assert.strictEqual(plugins[0].name, 'deploy-tools');
        assert.ok(plugins[0].installUrl.includes('github.com/acme/deploy-plugin'));
        assert.ok(plugins[0].installUrl.includes('v2.0.0'));
    });

    test('parses plugins with npm source', () => {
        const marketplace: MarketplaceFile = {
            name: 'npm-hub',
            owner: { name: 'Corp' },
            plugins: [
                {
                    name: 'my-npm-plugin',
                    source: { source: 'npm', package: '@acme/claude-plugin', version: '2.1.0' }
                }
            ]
        };

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 1);
        assert.ok(plugins[0].installUrl.includes('npm:@acme/claude-plugin@2.1.0'));
    });

    test('applies pluginRoot to relative path sources', () => {
        const marketplace: MarketplaceFile = {
            name: 'rooted',
            owner: { name: 'Corp' },
            metadata: { pluginRoot: './plugins' },
            plugins: [
                { name: 'my-tool', source: 'formatter' }
            ]
        };

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 1);
        assert.ok(plugins[0].installUrl.includes('plugins/formatter'));
    });

    test('returns empty array when plugins list is empty', () => {
        const marketplace: MarketplaceFile = {
            name: 'empty',
            owner: { name: 'Corp' },
            plugins: []
        };

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 0);
    });

    test('skips entries missing a name', () => {
        const marketplace = {
            name: 'test',
            owner: { name: 'Corp' },
            plugins: [
                { source: './plugins/unnamed' }
            ]
        } as unknown as MarketplaceFile;

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 0);
    });

    test('generates unique ids per plugin entry', () => {
        const marketplace: MarketplaceFile = {
            name: 'test',
            owner: { name: 'Corp' },
            plugins: [
                { name: 'plugin-a', source: './a' },
                { name: 'plugin-b', source: './b' }
            ]
        };

        const plugins = PluginMarketplaceParser.parse(marketplace, repoUrl, marketplacePath);
        assert.strictEqual(plugins.length, 2);
        assert.notStrictEqual(plugins[0].id, plugins[1].id);
    });
});

suite('PluginMarketplaceParser - ad-hoc', () => {
    const repoUrl = 'https://github.com/example/plugins';

    test('parses a simple ad-hoc manifest with string author', () => {
        const json = {
            name: 'my-plugin',
            description: 'A plugin',
            version: '1.0.0',
            author: 'Alice',
            source: './out'
        };
        const plugin = PluginMarketplaceParser.parseAdHoc(json, repoUrl, 'plugin.json');
        assert.ok(plugin);
        assert.strictEqual(plugin!.name, 'my-plugin');
        assert.strictEqual(plugin!.author, 'Alice');
    });

    test('parses a manifest with object author', () => {
        const json = {
            name: 'another-plugin',
            version: '2.0.0',
            author: { name: 'Bob', email: 'bob@example.com' },
            commands: { 'my-cmd': {} }
        };
        const plugin = PluginMarketplaceParser.parseAdHoc(json, repoUrl, 'tools/plugin.json');
        assert.ok(plugin);
        assert.strictEqual(plugin!.author, 'Bob');
    });

    test('returns null for manifest without a name', () => {
        const json = { version: '1.0.0', source: './out' };
        const plugin = PluginMarketplaceParser.parseAdHoc(json, repoUrl, 'something.json');
        assert.strictEqual(plugin, null);
    });

    test('uses relative path in installUrl', () => {
        const json = { name: 'test', source: './' };
        const plugin = PluginMarketplaceParser.parseAdHoc(json, repoUrl, 'sub/plugin.json');
        assert.ok(plugin!.installUrl.includes('sub/plugin.json'));
    });
});
