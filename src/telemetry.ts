import * as vscode from 'vscode';
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
            this.reporter.sendTelemetryEvent(eventName, properties, measurements);
        }
    }

    public sendError(error: Error, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
        if (this.isEnabled) {
            this.reporter.sendTelemetryErrorEvent('error', {
                ...properties,
                message: error.message,
                stack: error.stack || ''
            }, measurements);
        }
    }

    public dispose(): void {
        this.reporter.dispose();
    }
}
