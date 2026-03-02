import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TelemetryService } from '../services/telemetry';

suite('TelemetryService', () => {
    let sandbox: sinon.SinonSandbox;
    let appendLineStub: sinon.SinonStub;
    let createOutputChannelStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        appendLineStub = sandbox.stub();
        createOutputChannelStub = sandbox.stub(vscode.window, 'createOutputChannel').returns({
            appendLine: appendLineStub,
            dispose: sandbox.stub(),
            name: 'Agent Manager Telemetry',
            append: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            replace: sandbox.stub(),
        } as any);

        // Reset the singleton between tests
        (TelemetryService as any).instance = undefined;
    });

    teardown(() => {
        sandbox.restore();
        (TelemetryService as any).instance = undefined;
    });

    suite('local mode (no valid connection string)', () => {
        test('uses output channel when connection string is empty', () => {
            TelemetryService.getInstance('');
            assert.ok(createOutputChannelStub.calledOnce, 'Output channel should be created');
        });

        test('uses output channel when connection string is the placeholder key', () => {
            TelemetryService.getInstance('00000000-0000-0000-0000-000000000000');
            assert.ok(createOutputChannelStub.calledOnce, 'Output channel should be created');
        });

        test('sendEvent appends to output channel', () => {
            const service = TelemetryService.getInstance('');
            service.sendEvent('test.event', { key: 'value' });
            assert.ok(appendLineStub.calledOnce, 'appendLine should be called');
            assert.ok(
                appendLineStub.firstCall.args[0].includes('[Event] test.event'),
                'Log should contain event name'
            );
        });

        test('sendError appends to output channel', () => {
            const service = TelemetryService.getInstance('');
            service.sendError(new Error('test error'));
            assert.ok(appendLineStub.calledOnce, 'appendLine should be called');
            assert.ok(
                appendLineStub.firstCall.args[0].includes('[Error] test error'),
                'Log should contain error message'
            );
        });
    });

    suite('telemetry disabled', () => {
        test('sendEvent does not log when telemetry is disabled', () => {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: (_key: string) => false,
                has: sandbox.stub(),
                inspect: sandbox.stub(),
                update: sandbox.stub(),
            } as unknown as vscode.WorkspaceConfiguration);

            const service = TelemetryService.getInstance('');
            service.sendEvent('test.event');
            assert.ok(appendLineStub.notCalled, 'appendLine should not be called when telemetry is disabled');
        });

        test('sendError does not log when telemetry is disabled', () => {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: (_key: string) => false,
                has: sandbox.stub(),
                inspect: sandbox.stub(),
                update: sandbox.stub(),
            } as unknown as vscode.WorkspaceConfiguration);

            const service = TelemetryService.getInstance('');
            service.sendError(new Error('should not be logged'));
            assert.ok(appendLineStub.notCalled, 'appendLine should not be called when telemetry is disabled');
        });
    });

    suite('getInstance', () => {
        test('returns the same instance on subsequent calls', () => {
            const first = TelemetryService.getInstance('');
            const second = TelemetryService.getInstance('some-other-key');
            assert.strictEqual(first, second, 'Same singleton instance should be returned');
        });
    });
});
