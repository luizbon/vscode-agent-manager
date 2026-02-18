
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { AgentProvider } from '../agentProvider';
import { Agent } from '../agentDiscovery';

suite('AgentProvider Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let provider: AgentProvider;
    let mockContext: vscode.ExtensionContext;
    let globalState: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalState = {
            get: sandbox.stub().returns({}),
            update: sandbox.stub().resolves(),
            keys: () => []
        };
        mockContext = {
            globalState: globalState,
            workspaceState: {} as any,
            secrets: {} as any,
            extensionUri: vscode.Uri.file('/tmp'),
            globalStorageUri: vscode.Uri.file('/tmp/globalStorage'),
            logUri: vscode.Uri.file('/tmp/log'),
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (p: string) => p,
            storageUri: vscode.Uri.file('/tmp/storage'),
            subscriptions: [],
            environmentVariableCollection: {} as any,
            extension: {} as any,
        } as any;

        provider = new AgentProvider(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('addAgents updates state and fires event', () => {
        const fireStub = sandbox.stub((provider as any)._onDidChangeTreeData, 'fire');
        const agents: Agent[] = [{
            name: 'Test Agent',
            description: 'Desc',
            repository: 'repo',
            path: 'path',
            installUrl: 'url'
        }];

        provider.addAgents('repo', agents);

        assert.ok(globalState.update.called);
        assert.ok(fireStub.called);
        // Verify cache structure
        const cacheArg = globalState.update.firstCall.args[1];
        assert.deepStrictEqual(cacheArg['repo'].agents, agents);
        assert.strictEqual(typeof cacheArg['repo'].timestamp, 'number');
    });

    test('clear removes all agents', () => {
        provider.addAgents('repo', []);
        provider.clear();
        assert.ok((provider as any).repoAgents.size === 0);
    });

    test('prune removes agents from missing repos', () => {
        provider.addAgents('repo1', []);
        provider.addAgents('repo2', []);

        provider.prune(['repo1']); // keep repo1, remove repo2

        assert.ok((provider as any).repoAgents.has('repo1'));
        assert.strictEqual((provider as any).repoAgents.has('repo2'), false);
    });
});
