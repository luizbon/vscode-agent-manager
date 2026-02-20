
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { AgentDiscovery, Agent } from '../agentDiscovery';
import { GitService } from '../gitService';

suite('AgentDiscovery Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let agentDiscovery: AgentDiscovery;

    setup(() => {
        sandbox = sinon.createSandbox();
        const mockUri = { fsPath: '/mock/storage/path' } as vscode.Uri;
        agentDiscovery = new AgentDiscovery(mockUri);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('searchAgents handles failures gracefully', async () => {
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').rejects(new Error('Git failure'));

        // Suppress console.error
        sandbox.stub(console, 'error');
        // Suppress vscode error message
        sandbox.stub(vscode.window, 'showErrorMessage');

        const agents = await agentDiscovery.searchAgents(['https://github.com/invalid/repo']);
        assert.strictEqual(agents.length, 0);
    });

    test('fetchAgentsFromRepo processes agent files', async () => {
        sandbox.stub(GitService.prototype, 'cloneOrPullRepo').resolves();
        sandbox.stub(GitService.prototype, 'getRepoDirName').returns('mock_repo_dir');

        const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);

        const readdirStub = sandbox.stub(fs.promises, 'readdir').resolves([
            { name: 'test.agent.md', isDirectory: () => false },
            { name: 'other.file', isDirectory: () => false }
        ] as any);

        const agentContent = `---
name: Test Agent
description: A test agent
version: 1.0.0
author: Tester
tags: test, mock
---
This is a test agent.
`;

        sandbox.stub(fs.promises, 'readFile').resolves(agentContent);

        const agents = await agentDiscovery.fetchAgentsFromRepo('https://github.com/owner/repo');

        assert.strictEqual(agents.length, 1);
        assert.strictEqual(agents[0].name, 'Test Agent');
        assert.strictEqual(agents[0].version, '1.0.0');
        assert.strictEqual(agents[0].repository, 'https://github.com/owner/repo');
    });
});
