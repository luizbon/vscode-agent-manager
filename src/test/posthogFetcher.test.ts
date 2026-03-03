import * as assert from 'assert';
import * as https from 'https';
import * as sinon from 'sinon';
import { parseAiBody, transformEnvelope, createPostHogFetcher } from '../services/posthogFetcher';

suite('PostHog Fetcher', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
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
                baseType: 'EventData',
                baseData: {
                    name: 'agent.install',
                    properties: { 'common.os': 'linux', agentName: 'my-agent' },
                    measurements: { duration: 42 }
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

        test('maps ExceptionData envelope to a PostHog exception event', () => {
            const envelope = {
                baseType: 'ExceptionData',
                baseData: {
                    exceptions: [{
                        typeName: 'TypeError',
                        message: 'Cannot read property foo',
                        hasFullStack: true,
                        stack: 'Error: ...\n  at foo (bar.ts:1)'
                    }],
                    properties: { context: 'git.clone' }
                }
            };
            const result = transformEnvelope(envelope, API_KEY, DISTINCT_ID);
            assert.ok(result);
            assert.strictEqual(result!.event, 'exception:TypeError');
            assert.strictEqual(result!.properties['$exception_type'], 'TypeError');
            assert.strictEqual(result!.properties['$exception_message'], 'Cannot read property foo');
            assert.ok(result!.properties['$exception_stack_trace_raw']);
            assert.strictEqual(result!.properties['context'], 'git.clone');
        });

        test('falls back to envelope.name when baseData.name is missing', () => {
            const envelope = { name: 'fallback.event', baseType: 'EventData', baseData: {} };
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
                { baseType: 'EventData', baseData: { name: 'test.event', properties: {}, measurements: {} } }
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
            const body = JSON.stringify([{ baseType: 'EventData', baseData: { name: 'evt' } }]);

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
