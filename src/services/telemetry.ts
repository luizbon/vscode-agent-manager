import * as vscode from 'vscode';
import * as os from 'os';
import { TelemetryReporter } from '@vscode/extension-telemetry';

// This value is replaced by the CI pipeline with the real App Insights connection string.
// DO NOT split or alter the literal below — the pipeline targets it via sed.
const CONNECTION_STRING = '00000000-0000-0000-0000-000000000000';

// Constructed at runtime so that sed does NOT replace this comparison value.
// Allows us to detect whether the pipeline injection actually ran.
const ZERO_GUID = ['00000000', '0000', '0000', '0000', '000000000000'].join('-');

export class TelemetryService {
    private static instance: TelemetryService;
    private reporter?: TelemetryReporter;
    private outputChannel?: vscode.OutputChannel;
    private readonly isLocalLog: boolean;

    private constructor() {
        const isPlaceholder = !CONNECTION_STRING || CONNECTION_STRING === ZERO_GUID;
        this.isLocalLog = isPlaceholder;

        if (isPlaceholder) {
            this.outputChannel = vscode.window.createOutputChannel('Agent Manager Telemetry');
        } else {
            this.reporter = new TelemetryReporter(CONNECTION_STRING);
        }
    }

    private get isEnabled(): boolean {
        return vscode.workspace.getConfiguration('agentManager').get<boolean>('enableTelemetry') ?? true;
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
            this.outputChannel?.appendLine(`[Event] ${eventName} | Props: ${JSON.stringify(props)} | Metrics: ${JSON.stringify(measurements ?? {})}`);
        } else {
            this.reporter?.sendTelemetryEvent(eventName, props, measurements);
        }
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
            this.outputChannel?.appendLine(`[Error] ${error.message} | Props: ${JSON.stringify(props)} | Metrics: ${JSON.stringify(measurements ?? {})}`);
        } else {
            this.reporter?.sendTelemetryErrorEvent('error', props, measurements);
        }
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
        this.outputChannel?.dispose();
    }
}
