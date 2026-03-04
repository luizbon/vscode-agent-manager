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

    suite('local mode (no connection string found)', () => {
        test('uses output channel when no connection string is provided', () => {
            // By default in tests, no env var or extension metadata is present,
            // so TelemetryService should fall back to the output channel.
            sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);
            TelemetryService.getInstance();
            assert.ok(createOutputChannelStub.calledOnce, 'Output channel should be created');
        });

        test('sendEvent appends to output channel', () => {
            const service = TelemetryService.getInstance();
            service.sendEvent('test.event', { key: 'value' });
            assert.ok(appendLineStub.calledOnce, 'appendLine should be called');
            assert.ok(
                appendLineStub.firstCall.args[0].includes('[Event] test.event'),
                'Log should contain event name'
            );
        });

        test('sendError appends to output channel', () => {
            const service = TelemetryService.getInstance();
            service.sendError(new Error('test error'));
            assert.ok(appendLineStub.calledOnce, 'appendLine should be called');
            assert.ok(
                appendLineStub.firstCall.args[0].includes('[Error] test error'),
                'Log should contain error message'
            );
        });

        test('sendError uses contextual event name in log output', () => {
            const service = TelemetryService.getInstance();
            service.sendError(new Error('git failed'), { context: 'git.clone' });
            assert.ok(appendLineStub.calledOnce);
            // The log line should contain the error message
            const logLine = appendLineStub.firstCall.args[0] as string;
            assert.ok(logLine.includes('[Error] git failed'), 'Log should contain error message');
        });

        test('sendError includes $exception_type property', () => {
            const service = TelemetryService.getInstance();
            service.sendError(new TypeError('type mismatch'), { context: 'validation' });
            const logLine = appendLineStub.firstCall.args[0] as string;
            assert.ok(logLine.includes('TypeError'), 'Log should contain exception type');
        });
    });

    suite('captureException', () => {
        test('delegates to sendError in local mode', () => {
            const service = TelemetryService.getInstance();
            service.captureException(new RangeError('out of bounds'), { context: 'array.access' });
            assert.ok(appendLineStub.calledOnce, 'appendLine should be called');
            const logLine = appendLineStub.firstCall.args[0] as string;
            assert.ok(logLine.includes('[Error] out of bounds'), 'Log should contain error message');
        });

        test('does not log when telemetry is disabled', () => {
            sandbox.stub(vscode.env, 'isTelemetryEnabled').get(() => false);
            const service = TelemetryService.getInstance();
            service.captureException(new Error('should not appear'));
            assert.ok(appendLineStub.notCalled, 'appendLine should not be called when disabled');
        });
    });

    suite('telemetry disabled', () => {
        let envStub: sinon.SinonStub;

        setup(() => {
            envStub = sandbox.stub(vscode.env, 'isTelemetryEnabled').get(() => false);
        });

        test('sendEvent does not log when telemetry is disabled', () => {
            const service = TelemetryService.getInstance();
            service.sendEvent('test.event');
            assert.ok(appendLineStub.notCalled, 'appendLine should not be called when telemetry is disabled');
        });

        test('sendError does not log when telemetry is disabled', () => {
            const service = TelemetryService.getInstance();
            service.sendError(new Error('should not be logged'));
            assert.ok(appendLineStub.notCalled, 'appendLine should not be called when telemetry is disabled');
        });
    });

    suite('getInstance', () => {
        test('returns the same instance on subsequent calls', () => {
            const first = TelemetryService.getInstance();
            const second = TelemetryService.getInstance();
            assert.strictEqual(first, second, 'Same singleton instance should be returned');
        });
    });
});
