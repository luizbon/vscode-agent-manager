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
 */
export function transformEnvelope(
    envelope: AiEnvelope,
    apiKey: string,
    distinctId: string
): PostHogEvent | null {
    const baseData = envelope.baseData;
    const isException = envelope.baseType === 'ExceptionData';

    // Derive a meaningful event name
    let eventName: string;
    if (isException) {
        const exType = baseData?.exceptions?.[0]?.typeName;
        eventName = exType ? `exception:${exType}` : 'exception';
    } else {
        eventName = baseData?.name ?? envelope.name ?? 'telemetry';
    }

    const properties: Record<string, unknown> = {
        ...(baseData?.properties ?? {})
    };

    // Merge measurements into properties with a numeric type (PostHog accepts mixed types)
    if (baseData?.measurements) {
        for (const [key, value] of Object.entries(baseData.measurements)) {
            properties[key] = value;
        }
    }

    // For exceptions, also include stack/message at top level
    if (isException && baseData?.exceptions?.length) {
        const ex = baseData.exceptions[0];
        properties['$exception_type'] = ex.typeName ?? '';
        properties['$exception_message'] = ex.message ?? '';
        if (ex.stack) {
            properties['$exception_stack_trace_raw'] = ex.stack;
        }
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
 * @param apiKey     PostHog project API key.
 * @param host       PostHog host URL (e.g. https://us.i.posthog.com).
 * @param distinctId A stable anonymous identifier for the VS Code machine.
 */
export function createPostHogFetcher(
    apiKey: string,
    host: string,
    distinctId: string
): CustomFetcher {
    const captureUrl = `${host.replace(/\/$/, '')}/capture`;

    return async (_url: string, init?: { method: 'POST'; headers?: Record<string, string>; body?: string }) => {
        try {
            const bodyString = init?.body ?? '[]';
            const envelopes = parseAiBody(bodyString);

            const sends = envelopes
                .map(env => transformEnvelope(env, apiKey, distinctId))
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
