import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { InstallerService, IStateStore, IConflictResolver } from '../application/installerService';
import { IMarketplaceItem } from '../domain/models/marketplaceItem';

suite('InstallerService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let stateStore: sinon.SinonStubbedInstance<IStateStore>;
    let conflictResolver: sinon.SinonStubbedInstance<IConflictResolver>;
    let installerService: InstallerService;

    setup(() => {
        sandbox = sinon.createSandbox();
        stateStore = {
            get: sandbox.stub(),
            update: sandbox.stub()
        };
        conflictResolver = {
            resolve: sandbox.stub()
        };
        // Mock isUserGlobalFn to always return false for simplicity
        installerService = new InstallerService(stateStore as any, conflictResolver as any, () => false);

        // Mock fs and git details to avoid side effects
        sandbox.stub(fs, 'existsSync').returns(true);
        sandbox.stub(fs.promises, 'mkdir').resolves();
        sandbox.stub(fs.promises, 'copyFile').resolves();
        sandbox.stub(fs.promises, 'readFile').resolves('content');
        sandbox.stub(fs.promises, 'writeFile').resolves();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should install agent directly in the target directory', async () => {
        const item: IMarketplaceItem = {
            id: 'repo:agents/my-agent.agent.md',
            type: 'agent',
            name: 'My Agent',
            description: 'Test',
            repository: 'https://github.com/user/repo',
            path: 'agents/my-agent.agent.md',
            installUrl: '/tmp/source/my-agent.agent.md'
        };
        const installBasePath = '/work/project/.github/agents';

        // We need to mock GitService because installItem creates a new instance
        // Or we can mock the methods of the instance created.
        // Since it's created via 'new GitService()', we should stub the prototype or use a library that intercepts 'new'.
        // Let's stub the copyItemFile which is where the path is ultimately used.
        const copyStub = sandbox.stub(installerService, 'copyItemFile').resolves();

        // Mock git details
        // Note: installItem calls new GitService()... we might need to mock the entire GitService class
        // but for path validation, we can just check what final path copyItemFile receives if we stub it.

        // To handle 'new GitService()', we can use sinon to stub the entire module if it was a default export,
        // but here it is a class. We can stub the prototype.
        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoRoot').resolves('/tmp/source');
        sandbox.stub(GitService.prototype, 'getHeadSha').resolves('sha123');

        await installerService.installItem(item, installBasePath);

        const expectedPath = path.join(installBasePath, 'my-agent.agent.md');
        assert.strictEqual(copyStub.calledOnceWith(item.installUrl, expectedPath), true, `Expected agent to be installed at ${expectedPath}`);
    });

    test('should replicate folder structure for skills with baseDirectory', async () => {
        const item: IMarketplaceItem = {
            id: 'repo:skills/my-feature/SKILL.md',
            type: 'skill',
            name: 'My Skill',
            description: 'Test',
            repository: 'https://github.com/user/repo',
            path: 'skills/my-feature/SKILL.md',
            installUrl: '/tmp/source/skills/my-feature/SKILL.md',
            baseDirectory: 'my-feature'
        };
        const installBasePath = '/work/project/.github/skills';

        const copyStub = sandbox.stub(installerService, 'copyItemFile').resolves();

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoRoot').resolves('/tmp/source');
        sandbox.stub(GitService.prototype, 'getHeadSha').resolves('sha123');

        await installerService.installItem(item, installBasePath);

        const expectedPath = path.join(installBasePath, 'my-feature', 'SKILL.md');
        assert.strictEqual(copyStub.calledOnceWith(item.installUrl, expectedPath), true, `Expected skill to be installed at ${expectedPath}`);
    });

    test('should not replicate folder structure if baseDirectory is empty', async () => {
        const item: IMarketplaceItem = {
            id: 'repo:SKILL.md',
            type: 'skill',
            name: 'Root Skill',
            description: 'Test',
            repository: 'https://github.com/user/repo',
            path: 'SKILL.md',
            installUrl: '/tmp/source/SKILL.md',
            baseDirectory: ''
        };
        const installBasePath = '/work/project/.github/skills';

        const copyStub = sandbox.stub(installerService, 'copyItemFile').resolves();

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoRoot').resolves('/tmp/source');
        sandbox.stub(GitService.prototype, 'getHeadSha').resolves('sha123');

        await installerService.installItem(item, installBasePath);

        const expectedPath = path.join(installBasePath, 'SKILL.md');
        assert.strictEqual(copyStub.calledOnceWith(item.installUrl, expectedPath), true, `Expected skill to be installed at ${expectedPath}`);
    });
});
