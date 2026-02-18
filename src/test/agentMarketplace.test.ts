
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { AgentMarketplaceProvider } from '../agentMarketplace';
import { Agent } from '../agentDiscovery';

suite('AgentMarketplaceProvider Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let provider: AgentMarketplaceProvider;
    let mockExtensionUri: vscode.Uri;
    let mockWebviewView: vscode.WebviewView;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockExtensionUri = vscode.Uri.file('/tmp');
        provider = new AgentMarketplaceProvider(mockExtensionUri);

        mockWebviewView = {
            webview: {
                options: {},
                html: '',
                onDidReceiveMessage: sandbox.stub(),
                postMessage: sandbox.stub().resolves(true),
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'vscode-resource:'
            },
            onDidChangeVisibility: sandbox.stub(),
            onDidDispose: sandbox.stub(),
            visible: true
        } as unknown as vscode.WebviewView;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('resolveWebviewView sets up webview', () => {
        const context = {} as vscode.WebviewViewResolveContext;
        const token = {} as vscode.CancellationToken;

        provider.resolveWebviewView(mockWebviewView, context, token);

        assert.strictEqual(mockWebviewView.webview.options.enableScripts, true);
        assert.ok((mockWebviewView.webview.html as string).includes('Agent Marketplace'));
        assert.ok((mockWebviewView.webview.onDidReceiveMessage as sinon.SinonStub).called);
    });

    test('updateAgents posts message to webview', () => {
        const context = {} as vscode.WebviewViewResolveContext;
        const token = {} as vscode.CancellationToken;
        provider.resolveWebviewView(mockWebviewView, context, token);

        const agents: Agent[] = [{ name: 'Test', description: 'Desc', repository: 'repo', path: 'path', installUrl: 'url' }];
        const installedAgents: Agent[] = [];

        provider.updateAgents(agents, installedAgents);

        const postMessageStub = mockWebviewView.webview.postMessage as sinon.SinonStub;
        assert.ok(postMessageStub.calledWith({
            type: 'updateAgents',
            agents: agents,
            installedAgents: installedAgents
        }));
    });

    test('Message handling: installAgent', () => {
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
        const context = {} as vscode.WebviewViewResolveContext;
        const token = {} as vscode.CancellationToken;
        provider.resolveWebviewView(mockWebviewView, context, token);

        // Simulate message
        const onDidReceiveMessageStub = mockWebviewView.webview.onDidReceiveMessage as sinon.SinonStub;
        const handler = onDidReceiveMessageStub.firstCall.args[0];

        const agent = { name: 'Test' };
        handler({ type: 'installAgent', agent });

        assert.ok(executeCommandStub.calledWith('agentManager.install', agent));
    });

    test('Message handling: viewDetails passes searchTerm', () => {
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
        const context = {} as vscode.WebviewViewResolveContext;
        const token = {} as vscode.CancellationToken;
        provider.resolveWebviewView(mockWebviewView, context, token);

        const onDidReceiveMessageStub = mockWebviewView.webview.onDidReceiveMessage as sinon.SinonStub;
        const handler = onDidReceiveMessageStub.firstCall.args[0];

        const agent = { name: 'Test' };
        const searchTerm = 'query';
        handler({ type: 'viewDetails', agent, searchTerm });

        assert.ok(executeCommandStub.calledWith('agentManager.openAgentDetails', agent, searchTerm));
    });

    test('Message handling: viewDidLoad triggers cached search', () => {
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
        const context = {} as vscode.WebviewViewResolveContext;
        const token = {} as vscode.CancellationToken;
        provider.resolveWebviewView(mockWebviewView, context, token);

        const onDidReceiveMessageStub = mockWebviewView.webview.onDidReceiveMessage as sinon.SinonStub;
        const handler = onDidReceiveMessageStub.firstCall.args[0];

        handler({ type: 'viewDidLoad' });

        // It should trigger search with force=false to load cache
        assert.ok(executeCommandStub.calledWith('agentManager.search', false));
    });
});
