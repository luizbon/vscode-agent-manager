import * as assert from 'assert';
import * as path from 'path';
import * as upath from 'upath';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { GitSource } from '../infrastructure/sources/gitSource';
import { AgentParser } from '../domain/services/agentParser';
import { SkillParser } from '../domain/services/skillParser';

suite('GitSource Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let gitSource: GitSource;

    setup(() => {
        sandbox = sinon.createSandbox();
        gitSource = new GitSource();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should only use the immediate parent folder for SKILL.md', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const globalStoragePath = '/tmp/storage';
        const destPath = path.join(globalStoragePath, 'repos', 'repo_hash');

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('repo_hash');
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').resolves();

        // Deep path: plugins/copilot-sdk/skills/copilot-sdk/SKILL.md
        const skillPath = path.join(destPath, 'plugins', 'copilot-sdk', 'skills', 'copilot-sdk', 'SKILL.md');
        sandbox.stub(gitSource as any, 'findFiles').resolves([skillPath]);

        sandbox.stub(fs.promises, 'readFile').resolves('content');
        const parseSpy = sandbox.spy(SkillParser, 'parse');

        await gitSource.fetchItems(repoUrl, globalStoragePath);

        assert.strictEqual(parseSpy.calledOnce, true);
        const args = parseSpy.getCall(0).args;
        // Should only be 'copilot-sdk'
        assert.strictEqual(args[3], 'copilot-sdk');
    });

    test('should skip "skills" or "skill" parent foldernames', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const globalStoragePath = '/tmp/storage';
        const destPath = path.join(globalStoragePath, 'repos', 'repo_hash');

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('repo_hash');
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').resolves();

        // Path ending in .../skills/SKILL.md
        const skillPath = path.join(destPath, 'plugins', 'skills', 'SKILL.md');
        sandbox.stub(gitSource as any, 'findFiles').resolves([skillPath]);

        sandbox.stub(fs.promises, 'readFile').resolves('content');
        const parseSpy = sandbox.spy(SkillParser, 'parse');

        await gitSource.fetchItems(repoUrl, globalStoragePath);

        assert.strictEqual(parseSpy.calledOnce, true);
        const args = parseSpy.getCall(0).args;
        assert.strictEqual(args[3], '', 'Should have skipped generic "skills" parent');
    });

    test('should NOT use parent folder for individual .agent.md files', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const globalStoragePath = '/tmp/storage';
        const destPath = path.join(globalStoragePath, 'repos', 'repo_hash');

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('repo_hash');
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').resolves();

        const agentPath = path.join(destPath, 'agents', 'my-feature', 'my-agent.agent.md');
        sandbox.stub(gitSource as any, 'findFiles').resolves([agentPath]);

        sandbox.stub(fs.promises, 'readFile').resolves('content');
        const parseSpy = sandbox.spy(AgentParser, 'parse');

        await gitSource.fetchItems(repoUrl, globalStoragePath);

        assert.strictEqual(parseSpy.calledOnce, true);
        const args = parseSpy.getCall(0).args;
        assert.strictEqual(args[3], '', 'Agents should not have a baseDirectory replication by default');
    });

    test('should handle SKILL.md at the root of the repository', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const globalStoragePath = '/tmp/storage';
        const destPath = path.join(globalStoragePath, 'repos', 'repo_hash');

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('repo_hash');
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').resolves();

        const skillPath = path.join(destPath, 'SKILL.md');
        sandbox.stub(gitSource as any, 'findFiles').resolves([skillPath]);

        sandbox.stub(fs.promises, 'readFile').resolves('content');
        const parseSpy = sandbox.spy(SkillParser, 'parse');

        await gitSource.fetchItems(repoUrl, globalStoragePath);

        assert.strictEqual(parseSpy.calledOnce, true);
        const args = parseSpy.getCall(0).args;
        assert.strictEqual(args[3], '');
    });

    test('should correctly handle mixed separators in paths (canonicalization test)', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const globalStoragePath = '/tmp/storage';
        const destPath = '/tmp/storage/repos/repo_hash';

        const { GitService } = require('../services/gitService');
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('repo_hash');
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').resolves();

        // Simulating a path with backslashes
        // The code should normalize the input to forward slashes before calculating relative paths
        const skillPath = destPath + '/plugins/copilot-sdk/skills/my-feat/SKILL.md';
        sandbox.stub(gitSource as any, 'findFiles').resolves([skillPath]);

        sandbox.stub(fs.promises, 'readFile').resolves('content');
        const parseSpy = sandbox.spy(SkillParser, 'parse');

        await gitSource.fetchItems(repoUrl, globalStoragePath);

        assert.strictEqual(parseSpy.calledOnce, true, 'SkillParser.parse should have been called');
        const args = parseSpy.getCall(0).args;
        // The baseDirectory should be normalized to my-feat regardless of input separators
        assert.strictEqual(args[3], 'my-feat');
    });
});
