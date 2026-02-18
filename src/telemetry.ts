import * as vscode from 'vscode';
import * as os from 'os';
import { TelemetryReporter } from '@vscode/extension-telemetry';

// TODO: Replace with your actual Application Insights Instrumentation Key
const INSTRUMENTATION_KEY = '00000000-0000-0000-0000-000000000000';

export class TelemetryService {
    private static instance: TelemetryService;
    private reporter: TelemetryReporter;

    private constructor() {
        this.reporter = new TelemetryReporter(INSTRUMENTATION_KEY);
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
            this.reporter.sendTelemetryEvent(eventName, { ...commonProperties, ...properties }, measurements);
        }
    }

    public sendError(error: Error, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
        if (this.isEnabled) {
            const commonProperties = this.getCommonProperties();
            this.reporter.sendTelemetryErrorEvent('error', {
                ...commonProperties,
                ...properties,
                message: error.message,
                stack: error.stack || ''
            }, measurements);
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
