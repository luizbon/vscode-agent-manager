import * as vscode from 'vscode';
import * as os from 'os';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { createPostHogFetcher } from './posthogFetcher';

// Default PostHog host
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

const EXTENSION_ID = 'luizbon.vscode-agent-manager';

export class TelemetryService {
    private static instance: TelemetryService;
    private reporter?: TelemetryReporter;
    private posthogReporter?: TelemetryReporter;
    private outputChannel?: vscode.OutputChannel;
    private readonly isLocalLog: boolean;

    private constructor() {
        const connectionString = this.getConnectionString();
        const postHogKey = this.getPostHogApiKey();
        const postHogHost = this.getPostHogHost() || DEFAULT_POSTHOG_HOST;

        this.isLocalLog = !connectionString;

        if (this.isLocalLog) {
            this.outputChannel = vscode.window.createOutputChannel('Agent Manager Telemetry');
        } else {
            this.reporter = new TelemetryReporter(connectionString!);
        }

        if (postHogKey) {
            // The TelemetryReporter constructor requires a connection string even when
            // routing exclusively to PostHog. Use the App Insights key when available,
            // falling back to a dummy value that won't point to a real AI endpoint
            // (PostHog traffic goes through the custom fetcher, not AI infrastructure).
            const reporterKey = connectionString || 'InstrumentationKey=00000000-0000-0000-0000-000000000001';
            this.posthogReporter = new TelemetryReporter(
                reporterKey,
                undefined, // replacementOptions
                undefined, // initializationOptions
                createPostHogFetcher(
                    postHogKey,
                    postHogHost,
                    vscode.env.machineId
                ),
                {
                    endpointUrl: `${postHogHost.replace(/\/$/, '')}/capture`,
                    commonProperties: this.getCommonProperties()
                }
            );
        }
    }

    private getConnectionString(): string | undefined {
        if (process.env.TELEMETRY_CONNECTION_STRING) {
            return process.env.TELEMETRY_CONNECTION_STRING;
        }
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        return ext?.packageJSON?.telemetryConnectionString;
    }

    private getPostHogApiKey(): string | undefined {
        if (process.env.POSTHOG_API_KEY) {
            return process.env.POSTHOG_API_KEY;
        }
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        return ext?.packageJSON?.posthogApiKey;
    }

    private getPostHogHost(): string | undefined {
        if (process.env.POSTHOG_HOST) {
            return process.env.POSTHOG_HOST;
        }
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        return ext?.packageJSON?.posthogHost;
    }

    private get isEnabled(): boolean {
        return vscode.env.isTelemetryEnabled;
    }

    public static getInstance(): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService();
        }
        return TelemetryService.instance;
    }

    public sendEvent(eventName: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
        if (!this.isEnabled) {
            return;
        }
        const props = { ...this.getCommonProperties(), ...properties };
        if (this.isLocalLog) {
            // No App Insights key injected — log locally for development visibility.
            this.outputChannel?.appendLine(`[Event] ${eventName} | Props: ${JSON.stringify(props)} | Metrics: ${JSON.stringify(measurements ?? {})}`);
        } else {
            this.reporter?.sendTelemetryEvent(eventName, props, measurements);
        }
        // PostHog is independent of the App Insights key — always forward when configured.
        this.posthogReporter?.sendTelemetryEvent(eventName, props, measurements);
    }

    public sendError(error: Error, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
        if (!this.isEnabled) {
            return;
        }
        const props = {
            ...this.getCommonProperties(),
            ...properties,
            message: error.message,
            stack: error.stack ?? ''
        };
        if (this.isLocalLog) {
            // No App Insights key injected — log locally for development visibility.
            this.outputChannel?.appendLine(`[Error] ${error.message} | Props: ${JSON.stringify(props)} | Metrics: ${JSON.stringify(measurements ?? {})}`);
        } else {
            this.reporter?.sendTelemetryErrorEvent('error', props, measurements);
        }
        // PostHog is independent of the App Insights key — always forward when configured.
        this.posthogReporter?.sendTelemetryErrorEvent('error', props, measurements);
    }

    private getCommonProperties(): { [key: string]: string } {
        return {
            'common.os': os.platform(),
            'common.platformversion': os.release(),
            'common.arch': os.arch(),
            'common.vscodeversion': vscode.version,
            'common.extensionversion': vscode.extensions.getExtension('luizbon.vscode-agent-manager')?.packageJSON.version || 'unknown',
            'common.remotename': vscode.env.remoteName || 'local',
            'common.sessionid': vscode.env.sessionId
        };
    }

    public dispose(): void {
        this.reporter?.dispose();
        this.posthogReporter?.dispose();
        this.outputChannel?.dispose();
    }
}
