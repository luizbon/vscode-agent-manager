
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as https from 'https';
import { AgentInstaller } from '../agentInstaller';
import { Agent } from '../agentDiscovery';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

suite('AgentInstaller Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let installer: AgentInstaller;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
                keys: () => []
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub()
            } as any,
            secrets: {
                get: sandbox.stub(),
                store: sandbox.stub(),
                delete: sandbox.stub(),
                onDidChange: new vscode.EventEmitter().event
            } as any,
            extensionUri: vscode.Uri.file('/tmp'),
            globalStorageUri: vscode.Uri.file('/tmp/globalStorage'),
            logUri: vscode.Uri.file('/tmp/log'),
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath: string) => `/tmp/${relativePath}`,
            storageUri: vscode.Uri.file('/tmp/storage'),
            subscriptions: [],
            environmentVariableCollection: {} as any,
            extension: {
                id: 'test.extension',
                extensionUri: vscode.Uri.file('/tmp'),
                packageJSON: {},
                extensionKind: vscode.ExtensionKind.UI,
                isActive: true,
                exports: undefined,
                activate: () => Promise.resolve(),
            } as any,
            storagePath: '/tmp/storage',
            globalStoragePath: '/tmp/globalStorage',
            logPath: '/tmp/log',
        } as unknown as vscode.ExtensionContext;

        installer = new AgentInstaller(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Installs agent correctly', async () => {
        const agent: Agent = {
            name: 'Test Agent',
            description: 'Test Description',
            version: '1.0.0',
            installUrl: 'https://example.com/agent.md',
            path: 'agent.md',
            repository: 'https://github.com/owner/repo'
        };

        const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves({
            label: 'Install to Workspace',
            description: '/tmp/workspace/.github/agents'
        } as any);

        const fsExistsSyncStub = sandbox.stub(fs, 'existsSync').returns(true); // Don't create dir
        const fsMkdirSyncStub = sandbox.stub(fs, 'mkdirSync');

        const fileStream = new PassThrough() as any;
        fileStream.close = sandbox.stub();
        const fsCreateWriteStreamStub = sandbox.stub(fs, 'createWriteStream').returns(fileStream); // Mock file stream

        // Mock https response
        // Handle (url, cb) or (url, options, cb)
        const httpsStub = sandbox.stub(https, 'get').callsFake((...args: any[]) => {
            const cb = args.length > 1 && typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;

            const res = new EventEmitter() as any;
            res.statusCode = 200;
            const contentStream = new PassThrough();
            res.pipe = (dest: any) => {
                contentStream.pipe(dest);
                return dest;
            };

            if (cb) cb(res);

            contentStream.write('mock content');
            contentStream.end();
            return new EventEmitter() as any;
        });

        // Stub workspace open/show
        const openDocStub = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as any);
        const showDocStub = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as any);
        const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage');


        await installer.installAgent(agent);

        assert.ok(showQuickPickStub.calledOnce);
        assert.ok(httpsStub.calledWith(agent.installUrl));
        assert.ok(showInfoStub.calledWithMatch(sinon.match(/installed successfully/)));
    });
});
