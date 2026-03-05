import * as assert from 'assert';
import * as https from 'https';
import * as sinon from 'sinon';
import { parseAiBody, transformEnvelope, createPostHogFetcher, parseStackTrace } from '../services/posthogFetcher';

suite('PostHog Fetcher', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    // -----------------------------------------------------------------------
    // parseStackTrace
    // -----------------------------------------------------------------------
    suite('parseStackTrace', () => {
        test('returns empty array for undefined input', () => {
            assert.deepStrictEqual(parseStackTrace(undefined), []);
        });

        test('returns empty array for empty string', () => {
            assert.deepStrictEqual(parseStackTrace(''), []);
        });

        test('returns empty array for message-only stack (no frames)', () => {
            assert.deepStrictEqual(parseStackTrace('Error: something went wrong'), []);
        });

        test('parses a multi-line V8 stack trace with named functions', () => {
            const stack = [
                'Error: test error',
                '    at GitService.clone (/src/services/gitService.ts:70:15)',
                '    at GitService.cloneOrPullRepo (/src/services/gitService.ts:58:18)',
                '    at Object.<anonymous> (/src/test/runner.ts:10:5)',
            ].join('\n');

            const frames = parseStackTrace(stack);
            assert.strictEqual(frames.length, 3);

            assert.strictEqual(frames[0].function, 'GitService.clone');
            assert.strictEqual(frames[0].filename, '/src/services/gitService.ts');
            assert.strictEqual(frames[0].lineno, 70);
            assert.strictEqual(frames[0].colno, 15);
            assert.strictEqual(frames[0].platform, 'custom');
            assert.strictEqual(frames[0].lang, 'javascript');
            assert.strictEqual(frames[0].in_app, true);

            assert.strictEqual(frames[2].function, 'Object.<anonymous>');
        });

        test('parses anonymous-form frames (at file:line:col)', () => {
            const stack = [
                'Error: boom',
                '    at /src/extension.ts:27:3',
            ].join('\n');

            const frames = parseStackTrace(stack);
            assert.strictEqual(frames.length, 1);
            assert.strictEqual(frames[0].function, '<anonymous>');
            assert.strictEqual(frames[0].filename, '/src/extension.ts');
            assert.strictEqual(frames[0].lineno, 27);
            assert.strictEqual(frames[0].colno, 3);
        });

        test('marks node_modules frames as not in_app', () => {
            const stack = [
                'Error: dep error',
                '    at SomeLib.run (/proj/node_modules/some-lib/index.js:5:10)',
            ].join('\n');

            const frames = parseStackTrace(stack);
            assert.strictEqual(frames.length, 1);
            assert.strictEqual(frames[0].in_app, false);
        });

        test('handles new constructor invocations', () => {
            const stack = [
                'Error: ctor',
                '    at new AgentInstaller (/src/agent/agentInstaller.ts:9:5)',
            ].join('\n');

            const frames = parseStackTrace(stack);
            assert.strictEqual(frames.length, 1);
            assert.strictEqual(frames[0].function, 'AgentInstaller');
        });

        test('handles async frames', () => {
            const stack = [
                'Error: async err',
                '    at async GitService.pull (/src/services/gitService.ts:102:9)',
            ].join('\n');

            const frames = parseStackTrace(stack);
            assert.strictEqual(frames.length, 1);
            assert.strictEqual(frames[0].function, 'GitService.pull');
            assert.strictEqual(frames[0].lineno, 102);
        });

        test('handles frames without column number', () => {
            const stack = [
                'Error: no col',
                '    at process (/src/runner.ts:42)',
            ].join('\n');

            const frames = parseStackTrace(stack);
            assert.strictEqual(frames.length, 1);
            assert.strictEqual(frames[0].lineno, 42);
            assert.strictEqual(frames[0].colno, undefined);
        });
    });

    // -----------------------------------------------------------------------
    // parseAiBody
    // -----------------------------------------------------------------------
    suite('parseAiBody', () => {
        test('parses a JSON array envelope', () => {
            const input = JSON.stringify([
                { name: 'event1', baseType: 'EventData', baseData: { name: 'event1' } },
                { name: 'event2', baseType: 'EventData', baseData: { name: 'event2' } }
            ]);
            const result = parseAiBody(input);
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].name, 'event1');
            assert.strictEqual(result[1].name, 'event2');
        });

        test('parses a single JSON object envelope', () => {
            const input = JSON.stringify({ name: 'solo', baseType: 'EventData', baseData: { name: 'solo' } });
            const result = parseAiBody(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'solo');
        });

        test('parses newline-delimited JSON envelope', () => {
            const line1 = JSON.stringify({ name: 'a', baseType: 'EventData', baseData: { name: 'a' } });
            const line2 = JSON.stringify({ name: 'b', baseType: 'EventData', baseData: { name: 'b' } });
            const result = parseAiBody(`${line1}\n${line2}`);
            assert.strictEqual(result.length, 2);
        });

        test('returns empty array for malformed input', () => {
            const result = parseAiBody('not valid json');
            assert.deepStrictEqual(result, []);
        });
    });

    // -----------------------------------------------------------------------
    // transformEnvelope
    // -----------------------------------------------------------------------
    suite('transformEnvelope', () => {
        const API_KEY = 'phc_testkey';
        const DISTINCT_ID = 'machine-abc';

        test('maps EventData envelope to a PostHog event', () => {
            const envelope = {
                data: {
                    baseType: 'EventData',
                    baseData: {
                        name: 'agent.install',
                        properties: { 'common.os': 'linux', agentName: 'my-agent' },
                        measurements: { duration: 42 }
                    }
                }
            };
            const result = transformEnvelope(envelope, API_KEY, DISTINCT_ID);
            assert.ok(result, 'Result should not be null');
            assert.strictEqual(result!.event, 'agent.install');
            assert.strictEqual(result!.api_key, API_KEY);
            assert.strictEqual(result!.distinct_id, DISTINCT_ID);
            assert.strictEqual(result!.properties['common.os'], 'linux');
            assert.strictEqual(result!.properties['agentName'], 'my-agent');
            assert.strictEqual(result!.properties['duration'], 42);
        });

        test('maps ExceptionData envelope to a $exception event with $exception_list', () => {
            const stack = 'TypeError: Cannot read property foo\n  at foo (bar.ts:1:5)\n  at baz (qux.ts:10:3)';
            const envelope = {
                data: {
                    baseType: 'ExceptionData',
                    baseData: {
                        exceptions: [{
                            typeName: 'TypeError',
                            message: 'Cannot read property foo',
                            hasFullStack: true,
                            stack
                        }],
                        properties: { context: 'git.clone' }
                    }
                }
            };
            const result = transformEnvelope(envelope, API_KEY, DISTINCT_ID);
            assert.ok(result);
            // Event must be $exception per PostHog manual schema
            assert.strictEqual(result!.event, '$exception');

            // $exception_list must be present
            const exceptionList = result!.properties['$exception_list'] as Array<{
                type: string;
                value: string;
                mechanism: { handled: boolean; synthetic: boolean };
                stacktrace: { type: string; frames: Array<Record<string, unknown>> };
            }>;
            assert.ok(Array.isArray(exceptionList), '$exception_list should be an array');
            assert.strictEqual(exceptionList.length, 1);

            const ex = exceptionList[0];
            assert.strictEqual(ex.type, 'TypeError');
            assert.strictEqual(ex.value, 'Cannot read property foo');
            assert.deepStrictEqual(ex.mechanism, { handled: true, synthetic: false });
            assert.strictEqual(ex.stacktrace.type, 'raw');
            assert.ok(ex.stacktrace.frames.length >= 2, 'Should have parsed frames');
            assert.strictEqual(ex.stacktrace.frames[0].function, 'foo');

            // Backwards-compatible flat properties
            assert.strictEqual(result!.properties['$exception_type'], 'TypeError');
            assert.strictEqual(result!.properties['$exception_message'], 'Cannot read property foo');
            assert.ok(result!.properties['$exception_stack_trace_raw']);
            assert.strictEqual(result!.properties['context'], 'git.clone');
        });

        test('maps non-ExceptionData envelope with $exception_type to a $exception event', () => {
            const stack = 'Error: some error\n  at something (file.ts:1:1)';
            const envelope = {
                data: {
                    baseType: 'EventData',
                    baseData: {
                        name: 'error/myContext',
                        properties: {
                            context: 'myContext',
                            message: 'some error',
                            stack: stack,
                            '$exception_type': 'CustomError'
                        }
                    }
                }
            };
            const result = transformEnvelope(envelope, API_KEY, DISTINCT_ID);
            assert.ok(result);
            assert.strictEqual(result!.event, '$exception');

            // Should preserve original event name
            assert.strictEqual(result!.properties['error_context_name'], 'error/myContext');

            // $exception_list must be built
            const exceptionList = result!.properties['$exception_list'] as Array<any>;
            assert.ok(Array.isArray(exceptionList), '$exception_list should be an array');
            assert.strictEqual(exceptionList.length, 1);

            const ex = exceptionList[0];
            assert.strictEqual(ex.type, 'CustomError');
            assert.strictEqual(ex.value, 'some error');
            assert.strictEqual(ex.stacktrace.type, 'raw');

            // Flat properties
            assert.strictEqual(result!.properties['$exception_message'], 'some error');
            assert.strictEqual(result!.properties['$exception_stack_trace_raw'], stack);
            assert.strictEqual(result!.properties['context'], 'myContext');
        });

        test('falls back to envelope.name when baseData.name is missing', () => {
            const envelope = { name: 'fallback.event', data: { baseType: 'EventData', baseData: {} } };
            const result = transformEnvelope(envelope, API_KEY, DISTINCT_ID);
            assert.strictEqual(result!.event, 'fallback.event');
        });

        test('uses "telemetry" as event name when no name is available', () => {
            const result = transformEnvelope({}, API_KEY, DISTINCT_ID);
            assert.strictEqual(result!.event, 'telemetry');
        });

        test('includes a valid ISO 8601 timestamp', () => {
            const result = transformEnvelope({}, API_KEY, DISTINCT_ID);
            assert.ok(result);
            assert.doesNotThrow(() => new Date(result!.timestamp));
            assert.ok(result!.timestamp.includes('T'));
        });

        test('attaches $set and $set_once when commonProperties provided', () => {
            const commonProps = { 'common.os': 'darwin', 'common.arch': 'arm64' };
            const result = transformEnvelope({}, API_KEY, DISTINCT_ID, commonProps);
            assert.ok(result);
            assert.deepStrictEqual(result!.properties['$set'], commonProps);
            assert.deepStrictEqual(result!.properties['$set_once'], commonProps);
        });

        test('does not attach $set/$set_once when commonProperties is empty', () => {
            const result = transformEnvelope({}, API_KEY, DISTINCT_ID, {});
            assert.ok(result);
            assert.strictEqual(result!.properties['$set'], undefined);
            assert.strictEqual(result!.properties['$set_once'], undefined);
        });

        test('does not attach $set/$set_once when commonProperties is undefined', () => {
            const result = transformEnvelope({}, API_KEY, DISTINCT_ID);
            assert.ok(result);
            assert.strictEqual(result!.properties['$set'], undefined);
        });

        test('handles exception without stack trace gracefully', () => {
            const envelope = {
                data: {
                    baseType: 'ExceptionData',
                    baseData: {
                        exceptions: [{
                            typeName: 'Error',
                            message: 'no stack'
                        }]
                    }
                }
            };
            const result = transformEnvelope(envelope, API_KEY, DISTINCT_ID);
            assert.ok(result);
            assert.strictEqual(result!.event, '$exception');
            const exceptionList = result!.properties['$exception_list'] as Array<Record<string, unknown>>;
            assert.strictEqual(exceptionList.length, 1);
            const ex = exceptionList[0] as { stacktrace: { frames: unknown[] } };
            assert.deepStrictEqual(ex.stacktrace.frames, []);
        });
    });

    // -----------------------------------------------------------------------
    // createPostHogFetcher
    // -----------------------------------------------------------------------
    suite('createPostHogFetcher', () => {
        const API_KEY = 'phc_testkey';
        const HOST = 'https://us.i.posthog.com';
        const DISTINCT_ID = 'machine-abc';

        function stubHttpsRequest(statusCode = 200) {
            const fakeReq = {
                on: sandbox.stub().returnsThis(),
                write: sandbox.stub(),
                end: sandbox.stub()
            };
            const fakeRes = {
                on: sandbox.stub().callsFake((event: string, cb: (...args: unknown[]) => void) => {
                    if (event === 'end') { cb(); }
                    return fakeRes;
                }),
                statusCode
            };
            const requestStub = sandbox.stub(https, 'request').callsFake((_opts, callback) => {
                (callback as (res: typeof fakeRes) => void)(fakeRes);
                return fakeReq as any;
            });
            return { requestStub, fakeReq };
        }

        test('returns a CustomFetcher function', () => {
            const fetcher = createPostHogFetcher(API_KEY, HOST, DISTINCT_ID);
            assert.strictEqual(typeof fetcher, 'function');
        });

        test('sends a POST request to PostHog /capture for each envelope', async () => {
            const { requestStub, fakeReq } = stubHttpsRequest();

            const fetcher = createPostHogFetcher(API_KEY, HOST, DISTINCT_ID);
            const body = JSON.stringify([
                { data: { baseType: 'EventData', baseData: { name: 'test.event', properties: {}, measurements: {} } } }
            ]);

            const response = await fetcher('https://ignored-by-fetcher', { method: 'POST', body });

            assert.ok(requestStub.calledOnce);
            assert.strictEqual(response.status, 200);
            assert.ok(fakeReq.write.calledOnce);

            const sentBody = JSON.parse(fakeReq.write.firstCall.args[0]);
            assert.strictEqual(sentBody.event, 'test.event');
            assert.strictEqual(sentBody.api_key, API_KEY);
            assert.strictEqual(sentBody.distinct_id, DISTINCT_ID);
        });

        test('includes $set/$set_once when commonProperties supplied', async () => {
            const { fakeReq } = stubHttpsRequest();
            const commonProps = { 'common.os': 'linux' };

            const fetcher = createPostHogFetcher(API_KEY, HOST, DISTINCT_ID, commonProps);
            const body = JSON.stringify([
                { data: { baseType: 'EventData', baseData: { name: 'evt', properties: {} } } }
            ]);

            await fetcher('https://ignored', { method: 'POST', body });
            const sentBody = JSON.parse(fakeReq.write.firstCall.args[0]);
            assert.deepStrictEqual(sentBody.properties['$set'], commonProps);
            assert.deepStrictEqual(sentBody.properties['$set_once'], commonProps);
        });

        test('returns 200 even when PostHog request fails', async () => {
            const fakeReq = {
                on: sandbox.stub().callsFake((event: string, cb: (...args: unknown[]) => void) => {
                    if (event === 'error') { cb(new Error('network error')); }
                    return fakeReq;
                }),
                write: sandbox.stub(),
                end: sandbox.stub()
            };
            sandbox.stub(https, 'request').returns(fakeReq as any);

            const fetcher = createPostHogFetcher(API_KEY, HOST, DISTINCT_ID);
            const body = JSON.stringify([{ data: { baseType: 'EventData', baseData: { name: 'evt' } } }]);

            const response = await fetcher('https://ignored', { method: 'POST', body });
            assert.strictEqual(response.status, 200);
        });

        test('returns 200 for an empty batch', async () => {
            const fetcher = createPostHogFetcher(API_KEY, HOST, DISTINCT_ID);
            const response = await fetcher('https://ignored', { method: 'POST', body: '[]' });
            assert.strictEqual(response.status, 200);
        });

        test('does not throw when body is undefined', async () => {
            const fetcher = createPostHogFetcher(API_KEY, HOST, DISTINCT_ID);
            const response = await fetcher('https://ignored', { method: 'POST' });
            assert.strictEqual(response.status, 200);
        });
    });
});
