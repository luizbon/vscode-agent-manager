import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { DetailsPanel } from '../ui/panels/detailsPanel';
import { CliPlugin } from '../domain/models/cliPlugin';

/**
 * Creates a minimal DetailsPanel instance with all VS Code dependencies stubbed out,
 * so we can exercise private methods without needing a real extension context or webview.
 */
function createPanelUnderTest(globalStoragePath: string = '/tmp/global-storage'): {
    panel: DetailsPanel;
    postMessageStub: sinon.SinonStub;
} {
    const postMessageStub = sinon.stub();

    const fakeWebview = {
        postMessage: postMessageStub,
        onDidReceiveMessage: sinon.stub().returns({ dispose: sinon.stub() }),
        html: '',
        cspSource: 'vscode-resource:',
    };

    const fakePanel = {
        webview: fakeWebview,
        reveal: sinon.stub(),
        onDidDispose: sinon.stub().returns({ dispose: sinon.stub() }),
        dispose: sinon.stub(),
        title: '',
    };

    const fakeContext = {
        globalStorageUri: { fsPath: globalStoragePath },
        extensionUri: { fsPath: '/ext' },
    };

    const plugin = new CliPlugin(
        'test::marketplace.json::my-plugin',
        'My Plugin',
        'A test plugin',
        'https://github.com/owner/repo',
        'https://github.com/owner/repo',
        'marketplace.json',
    );

    // Access the private constructor via a type assertion, as done in other tests.
    // `createOrShow` would require a real ExtensionContext — use the constructor directly.
    const panel = new (DetailsPanel as any)(fakePanel, fakeContext, plugin) as DetailsPanel;

    return { panel, postMessageStub };
}

suite('DetailsPanel – fetchPluginContent', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('returns README from localSourcePath when it exists', async () => {
        const localSourcePath = '/tmp/my-plugin-src';
        const readmeContent = '# My Plugin README';

        sandbox.stub(fs, 'existsSync').callsFake((p: fs.PathLike) =>
            String(p) === path.join(localSourcePath, 'README.md')
        );
        sandbox.stub(fs.promises, 'readFile').resolves(readmeContent as any);

        const plugin = new CliPlugin(
            'test::path::plugin',
            'My Plugin',
            'desc',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo',
            'marketplace.json',
            undefined, undefined, undefined,
            localSourcePath
        );

        const { panel } = createPanelUnderTest();
        // Override the item on the panel so fetchPluginContent uses our plugin
        (panel as any)._item = plugin;

        const result = await (panel as any).fetchPluginContent(plugin);
        assert.strictEqual(result, readmeContent);
    });

    test('searches cloned repo root when localSourcePath is not set', async () => {
        const clonedRepoDir = '/tmp/global-storage/repos/owner_repo';
        const readmeContent = '# Repo README';

        sandbox.stub(fs, 'existsSync').callsFake((p: fs.PathLike) =>
            String(p) === path.join(clonedRepoDir, 'README.md')
        );
        sandbox.stub(fs.promises, 'readFile').resolves(readmeContent as any);

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('owner_repo');

        const plugin = new CliPlugin(
            'test::path::plugin',
            'My Plugin',
            'desc',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo',
            'marketplace.json',
        );

        const { panel } = createPanelUnderTest('/tmp/global-storage');
        const result = await (panel as any).fetchPluginContent(plugin);
        assert.strictEqual(result, readmeContent);
    });

    test('falls back to structured metadata when no README is found anywhere', async () => {
        sandbox.stub(fs, 'existsSync').returns(false);

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('owner_repo');

        const plugin = new CliPlugin(
            'test::path::plugin',
            'My Plugin',
            'A great plugin',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo',
            'marketplace.json',
            'Alice',
            '1.2.3',
            ['tag1', 'tag2'],
        );

        const { panel } = createPanelUnderTest('/tmp/global-storage');
        const result = await (panel as any).fetchPluginContent(plugin);

        assert.ok(result.includes('# My Plugin'), 'Should include plugin name');
        assert.ok(result.includes('A great plugin'), 'Should include description');
        assert.ok(result.includes('Alice'), 'Should include author');
        assert.ok(result.includes('1.2.3'), 'Should include version');
        assert.ok(result.includes('tag1'), 'Should include tags');
    });

    test('prefers localSourcePath README over cloned repo README', async () => {
        const localSourcePath = '/tmp/local-src';
        const clonedRepoDir = '/tmp/global-storage/repos/owner_repo';

        const localReadme = '# Local README';
        const clonedReadme = '# Cloned README';

        sandbox.stub(fs, 'existsSync').callsFake((p: fs.PathLike) => {
            const s = String(p);
            return s === path.join(localSourcePath, 'README.md') || s === path.join(clonedRepoDir, 'README.md');
        });

        sandbox.stub(fs.promises, 'readFile').callsFake((p: any) => {
            if (String(p) === path.join(localSourcePath, 'README.md')) {
                return Promise.resolve(localReadme as any);
            }
            return Promise.resolve(clonedReadme as any);
        });

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('owner_repo');

        const plugin = new CliPlugin(
            'test::path::plugin',
            'My Plugin',
            'desc',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo',
            'marketplace.json',
            undefined, undefined, undefined,
            localSourcePath
        );

        const { panel } = createPanelUnderTest('/tmp/global-storage');
        const result = await (panel as any).fetchPluginContent(plugin);
        assert.strictEqual(result, localReadme, 'Should prefer localSourcePath when both directories have a README');
    });
});

suite('DetailsPanel – fetchLastUpdated', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('posts N/A when CLI plugin has no resolvable local path', async () => {
        sandbox.stub(fs, 'existsSync').returns(false);

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('owner_repo');

        const plugin = new CliPlugin(
            'test::path::plugin',
            'My Plugin',
            'desc',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo',
            'marketplace.json',
        );

        const { panel, postMessageStub } = createPanelUnderTest('/tmp/global-storage');
        await (panel as any).fetchLastUpdated(plugin);

        assert.ok(
            postMessageStub.calledWith(sinon.match({ command: 'updateDate', date: 'N/A' })),
            'Should post N/A when no path is resolvable'
        );
    });

    test('posts N/A for non-plugin item with missing installUrl file', async () => {
        sandbox.stub(fs, 'existsSync').returns(false);

        const item = {
            id: 'test',
            type: 'agent' as const,
            name: 'My Agent',
            description: 'desc',
            repository: 'https://github.com/owner/repo',
            path: 'my.agent.md',
            installUrl: '/missing/path/my.agent.md',
        };

        const { panel, postMessageStub } = createPanelUnderTest('/tmp/global-storage');
        await (panel as any).fetchLastUpdated(item);

        assert.ok(
            postMessageStub.calledWith(sinon.match({ command: 'updateDate', date: 'N/A' })),
            'Should post N/A when installUrl does not exist'
        );
    });
});

suite('DetailsPanel – resolveClonedRepoDir', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('constructs path from globalStoragePath and repoDirName', () => {
        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('github_com_owner_repo');

        const plugin = new CliPlugin(
            'test', 'Plugin', 'desc',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo',
            'manifest.json'
        );

        const { panel } = createPanelUnderTest('/my/global/storage');
        const result = (panel as any).resolveClonedRepoDir(plugin);

        assert.strictEqual(result, path.join('/my/global/storage', 'repos', 'github_com_owner_repo'));
    });

    test('returns undefined when repository is not set', () => {
        const plugin = new CliPlugin(
            'test', 'Plugin', 'desc',
            '',
            '',
            'manifest.json'
        );

        const { panel } = createPanelUnderTest('/my/global/storage');
        const result = (panel as any).resolveClonedRepoDir(plugin);
        assert.strictEqual(result, undefined);
    });
});
