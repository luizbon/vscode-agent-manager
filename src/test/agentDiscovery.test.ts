
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as https from 'https';
import * as vscode from 'vscode';
import { AgentDiscovery, Agent } from '../agentDiscovery';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

suite('AgentDiscovery Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let agentDiscovery: AgentDiscovery;

    setup(() => {
        sandbox = sinon.createSandbox();
        agentDiscovery = new AgentDiscovery();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('parseGitHubUrl should return owner and repo', () => {
        const result = agentDiscovery.parseGitHubUrl('https://github.com/owner/repo');
        assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
    });

    test('parseGitHubUrl should handle .git suffix', () => {
        const result = agentDiscovery.parseGitHubUrl('https://github.com/owner/repo.git');
        assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
    });

    test('searchAgents handles failures gracefully', async () => {
        const httpsStub = sandbox.stub(https, 'get').callsFake((url, options, callback) => {
            const res = new EventEmitter() as any;
            res.statusCode = 404; // Simulate Not Found
            if (callback) callback(res);
            const req = new EventEmitter() as any;
            req.setTimeout = () => req;
            req.destroy = () => { };
            return req;
        });

        // Suppress console.error
        sandbox.stub(console, 'error');
        // Suppress vscode error message
        sandbox.stub(vscode.window, 'showErrorMessage');

        const agents = await agentDiscovery.searchAgents(['https://github.com/invalid/repo']);
        assert.strictEqual(agents.length, 0);
    });

    test('fetchAgentsFromRepo processes agent files', async () => {
        // Mock fetchGitHubTree
        // Private method, so cast to any or use prototype stub if careful.
        // Better: mock https calls sequence or stub the private method via prototype (risky if methods change).
        // Let's rely on stubbing https.get for the tree and then the content.

        const treeResponse = {
            tree: [
                { path: 'test.agent.md', type: 'blob' },
                { path: 'other.file', type: 'blob' }
            ]
        };

        const agentContent = `---
name: Test Agent
description: A test agent
version: 1.0.0
author: Tester
tags: test, mock
---
This is a test agent.
`;

        const httpsStub = sandbox.stub(https, 'get').callsFake((url: any, options: any, callback: any) => {
            const res = new EventEmitter() as any;
            const stream = new PassThrough();
            res.on = (event: string, cb: any) => {
                stream.on(event, cb);
                return res;
            };
            res.pipe = (dest: any) => stream.pipe(dest); // Not needed for simple data

            if (typeof url === 'string' && url.includes('/git/trees/')) {
                res.statusCode = 200;
                // It's recursive
                stream.write(JSON.stringify(treeResponse));
            } else if (typeof url === 'string' && url.endsWith('test.agent.md')) {
                res.statusCode = 200;
                stream.write(agentContent);
            } else {
                res.statusCode = 404;
            }
            stream.end();

            if (callback) callback(res);
            const req = new EventEmitter() as any;
            req.setTimeout = () => req;
            req.destroy = () => { };
            return req;
        });

        const agents = await agentDiscovery.fetchAgentsFromRepo('https://github.com/owner/repo');

        assert.strictEqual(agents.length, 1);
        assert.strictEqual(agents[0].name, 'Test Agent');
        assert.strictEqual(agents[0].version, '1.0.0');
        assert.strictEqual(agents[0].path, 'test.agent.md');
    });
});
