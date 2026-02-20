import * as vscode from 'vscode';
import * as os from 'os';
import { TelemetryReporter } from '@vscode/extension-telemetry';

// TODO: Replace with your actual Application Insights Instrumentation Key
const INSTRUMENTATION_KEY = '00000000-0000-0000-0000-000000000000';

export class TelemetryService {
    private static instance: TelemetryService;
    private reporter: TelemetryReporter;
    private outputChannel?: vscode.OutputChannel;
    private isLocalLog: boolean = false;

    private constructor() {
        this.reporter = new TelemetryReporter(INSTRUMENTATION_KEY);
        if (!INSTRUMENTATION_KEY || INSTRUMENTATION_KEY === '00000000-0000-0000-0000-000000000000') {
            this.isLocalLog = true;
            this.outputChannel = vscode.window.createOutputChannel('Agent Manager Telemetry');
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
        if (this.isEnabled) {
            const commonProperties = this.getCommonProperties();
            const props = { ...commonProperties, ...properties };
            if (this.isLocalLog) {
                this.outputChannel?.appendLine(`[Event] ${eventName} | Props: ${JSON.stringify(props)} | Metrics: ${JSON.stringify(measurements || {})}`);
            } else {
                this.reporter.sendTelemetryEvent(eventName, props, measurements);
            }
        }
    }

    public sendError(error: Error, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
        if (this.isEnabled) {
            const commonProperties = this.getCommonProperties();
            const props = {
                ...commonProperties,
                ...properties,
                message: error.message,
                stack: error.stack || ''
            };
            if (this.isLocalLog) {
                this.outputChannel?.appendLine(`[Error] ${error.message} | Props: ${JSON.stringify(props)} | Metrics: ${JSON.stringify(measurements || {})}`);
            } else {
                this.reporter.sendTelemetryErrorEvent('error', props, measurements);
            }
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
        this.reporter.dispose();
    }
}
