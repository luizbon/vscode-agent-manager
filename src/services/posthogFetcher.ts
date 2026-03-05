import * as https from 'https';
import type { CustomFetcher } from '@vscode/extension-telemetry';

/**
 * Shape of an Application Insights telemetry envelope as serialised by
 * the @vscode/extension-telemetry SDK. Only the fields we need are typed.
 */
interface AiEnvelope {
    name?: string;
    baseType?: string;
    baseData?: {
        name?: string;
        properties?: Record<string, string>;
        measurements?: Record<string, number>;
        exceptions?: Array<{
            typeName?: string;
            message?: string;
            hasFullStack?: boolean;
            stack?: string;
        }>;
    };
    data?: {
        baseType?: string;
        baseData?: {
            name?: string;
            properties?: Record<string, string>;
            measurements?: Record<string, number>;
            exceptions?: Array<{
                typeName?: string;
                message?: string;
                hasFullStack?: boolean;
                stack?: string;
            }>;
        };
    };
}

/**
 * PostHog capture event payload.
 * https://posthog.com/docs/api/capture
 */
interface PostHogEvent {
    api_key: string;
    event: string;
    distinct_id: string;
    timestamp: string;
    properties: Record<string, unknown>;
}

/**
 * A single frame within a PostHog exception stacktrace.
 * https://posthog.com/docs/error-tracking/installation/manual
 */
export interface PostHogStackFrame {
    platform: 'custom';
    lang: 'javascript';
    function: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    in_app?: boolean;
}

/**
 * Parse a V8/Node.js stack trace string into an array of PostHog-compatible
 * stack frames.  Handles formats such as:
 *   at functionName (filename:line:col)
 *   at filename:line:col
 *   at new ClassName (filename:line:col)
 *   at Object.<anonymous> (filename:line:col)
 */
export function parseStackTrace(stack: string | undefined): PostHogStackFrame[] {
    if (!stack) {
        return [];
    }

    const frames: PostHogStackFrame[] = [];
    const lines = stack.split('\n');

    // Regex matches:  at [async] [new] <fn> (<file>:<line>:<col>)
    //            or:  at [async] [new] <fn> (<file>:<line>)
    //            or:  at <file>:<line>:<col>
    const frameRegex = /^\s*at\s+(?:async\s+)?(?:new\s+)?(.+?)\s+\((.+?):(\d+)(?::(\d+))?\)$|^\s*at\s+(?:async\s+)?(.+?):(\d+)(?::(\d+))?$/;

    for (const line of lines) {
        const match = frameRegex.exec(line.trim());
        if (!match) {
            continue;
        }

        if (match[1] !== undefined) {
            // Named function form: at fn (file:line:col)
            frames.push({
                platform: 'custom',
                lang: 'javascript',
                function: match[1],
                filename: match[2],
                lineno: parseInt(match[3], 10),
                colno: match[4] ? parseInt(match[4], 10) : undefined,
                in_app: !match[2].includes('node_modules'),
            });
        } else if (match[5] !== undefined) {
            // Anonymous form: at file:line:col
            frames.push({
                platform: 'custom',
                lang: 'javascript',
                function: '<anonymous>',
                filename: match[5],
                lineno: parseInt(match[6], 10),
                colno: match[7] ? parseInt(match[7], 10) : undefined,
                in_app: !match[5].includes('node_modules'),
            });
        }
    }

    return frames;
}

/**
 * Minimal fetch-compatible response returned to the library after forwarding
 * to PostHog so the library considers the send successful.
 */
function makeResponse(status: number, body: string) {
    return {
        status,
        text: () => Promise.resolve(body),
        headers: [][Symbol.iterator]() as unknown as Iterable<[string, string]>
    };
}

/**
 * Post an event payload to PostHog using Node.js https, bypassing the
 * global `fetch` which may not be available in older VS Code runtimes.
 */
function postToPostHog(url: string, payload: PostHogEvent): Promise<void> {
    return new Promise((resolve) => {
        const body = JSON.stringify(payload);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        try {
            const req = https.request(options, (res) => {
                res.on('data', () => { /* consume */ });
                res.on('end', resolve);
                res.on('error', resolve);
            });
            req.on('error', resolve);
            req.write(body);
            req.end();
        } catch {
            resolve();
        }
    });
}

/**
 * Parse an Application Insights batch payload and extract individual event
 * envelopes. The SDK wraps events either as a JSON array or as newline-
 * delimited JSON; this function handles both forms.
 */
export function parseAiBody(bodyString: string): AiEnvelope[] {
    try {
        const parsed = JSON.parse(bodyString);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        // Try newline-delimited JSON
        return bodyString
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
                try {
                    const obj = JSON.parse(line);
                    return Array.isArray(obj) ? obj : [obj];
                } catch {
                    return [];
                }
            });
    }
}

/**
 * Transform an Application Insights envelope into a PostHog capture event.
 *
 * For exception envelopes, this produces a `$exception` event with a full
 * `$exception_list` array per the PostHog manual error tracking schema.
 *
 * @param commonProperties Optional common properties to attach as `$set` / `$set_once`
 *                         person properties for user-level filtering in PostHog.
 */
export function transformEnvelope(
    envelope: AiEnvelope,
    apiKey: string,
    distinctId: string,
    commonProperties?: Record<string, string>
): PostHogEvent | null {
    // VS Code Extension Telemetry passes envelopes with baseData wrapped in a `data` object.
    const dataObj = envelope.data || envelope;
    const baseData = dataObj.baseData;
    const isExceptionEnvelope = dataObj.baseType === 'ExceptionData';
    const isErrorEvent = isExceptionEnvelope || (baseData?.properties && '$exception_type' in baseData.properties);

    // Derive a meaningful event name
    let eventName: string;
    if (isErrorEvent) {
        eventName = '$exception';
    } else {
        eventName = baseData?.name ?? envelope.name ?? 'telemetry';
    }

    const properties: Record<string, unknown> = {
        ...(baseData?.properties ?? {})
    };

    // If we re-mapped a regular telemetry event to $exception, save the original event name
    if (isErrorEvent && !isExceptionEnvelope) {
        properties['error_context_name'] = baseData?.name ?? envelope.name ?? 'error';
    }

    // Merge measurements into properties with a numeric type (PostHog accepts mixed types)
    if (baseData?.measurements) {
        for (const [key, value] of Object.entries(baseData.measurements)) {
            properties[key] = value;
        }
    }

    // Build $exception_list per PostHog manual error tracking schema
    if (isErrorEvent) {
        if (isExceptionEnvelope && baseData?.exceptions?.length) {
            const exceptionList = baseData.exceptions.map(ex => {
                const frames = parseStackTrace(ex.stack);
                return {
                    type: ex.typeName ?? 'Error',
                    value: ex.message ?? '',
                    mechanism: {
                        handled: true,
                        synthetic: false,
                    },
                    stacktrace: {
                        type: 'raw' as const,
                        frames,
                    },
                };
            });

            properties['$exception_list'] = exceptionList;

            // Keep flat properties for backwards compatibility and PostHog search
            const firstEx = baseData.exceptions[0];
            properties['$exception_type'] = firstEx.typeName ?? '';
            properties['$exception_message'] = firstEx.message ?? '';
            if (firstEx.stack) {
                properties['$exception_stack_trace_raw'] = firstEx.stack;
            }
        } else if (baseData?.properties?.['$exception_type']) {
            const typeName = baseData.properties['$exception_type'];
            const message = baseData.properties['message'] || '';
            const stack = baseData.properties['stack'] || '';

            const frames = parseStackTrace(stack);
            const exceptionList = [{
                type: typeName,
                value: message,
                mechanism: {
                    handled: true,
                    synthetic: false,
                },
                stacktrace: {
                    type: 'raw' as const,
                    frames,
                },
            }];

            properties['$exception_list'] = exceptionList;
            properties['$exception_message'] = message;
            if (stack) {
                properties['$exception_stack_trace_raw'] = stack;
            }
        }
    }

    // Enrich with person properties for user-level filtering
    if (commonProperties && Object.keys(commonProperties).length > 0) {
        properties['$set'] = { ...commonProperties };
        properties['$set_once'] = { ...commonProperties };
    }

    return {
        api_key: apiKey,
        event: eventName,
        distinct_id: distinctId,
        timestamp: new Date().toISOString(),
        properties
    };
}

/**
 * Factory: creates a `CustomFetcher` compatible with `@vscode/extension-telemetry`
 * that intercepts Application Insights payloads and forwards them to PostHog.
 *
 * @param apiKey           PostHog project API key.
 * @param host             PostHog host URL (e.g. https://us.i.posthog.com).
 * @param distinctId       A stable anonymous identifier for the VS Code machine.
 * @param commonProperties Optional environment properties to send as `$set` / `$set_once`.
 */
export function createPostHogFetcher(
    apiKey: string,
    host: string,
    distinctId: string,
    commonProperties?: Record<string, string>
): CustomFetcher {
    const captureUrl = `${host.replace(/\/$/, '')}/capture`;

    return async (_url: string, init?: { method: 'POST'; headers?: Record<string, string>; body?: string }) => {
        try {
            const bodyString = init?.body ?? '[]';
            const envelopes = parseAiBody(bodyString);

            const sends = envelopes
                .map(env => transformEnvelope(env, apiKey, distinctId, commonProperties))
                .filter((evt): evt is PostHogEvent => evt !== null)
                .map(evt => postToPostHog(captureUrl, evt));

            await Promise.all(sends);
        } catch (err) {
            // Never let PostHog failures propagate — AI telemetry must remain unaffected.
            console.warn('[PostHog fetcher] Failed to forward telemetry:', err);
        }

        // Return a synthetic 200 so the library does not retry the envelope.
        return makeResponse(200, '{}') as ReturnType<CustomFetcher> extends Promise<infer R> ? R : never;
    };
}
