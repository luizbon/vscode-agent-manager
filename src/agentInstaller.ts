import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from './agentDiscovery';
import * as https from 'https';

export class AgentInstaller {
    constructor(private context: vscode.ExtensionContext) { }

    public async installAgent(agent: Agent, targetPath?: string) {
        const installOptions: vscode.QuickPickItem[] = [];

        if (targetPath) {
            // Direct update/overwrite
            try {
                await this.downloadFile(agent.installUrl, targetPath);
                vscode.window.showInformationMessage(`Agent ${agent.name} updated successfully at ${targetPath}`);

                const doc = await vscode.workspace.openTextDocument(targetPath);
                await vscode.window.showTextDocument(doc);
                return;
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update agent: ${error}`);
                return;
            }
        }

        // 1. Determine workspace installation options from chat.agentFilesLocations
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('chat');
            const locations = config.get<string[]>('agentFilesLocations') || [];

            if (locations.length > 0) {
                for (const loc of locations) {
                    const fullPath = path.isAbsolute(loc) ? loc : path.join(workspaceRoot, loc);
                    installOptions.push({
                        label: `Install to Workspace (${loc})`,
                        description: fullPath,
                        detail: 'Custom location defined in chat.agentFilesLocations'
                    });
                }
            } else {
                // Default workspace location
                const defaultPath = path.join(workspaceRoot, '.github', 'agents');
                installOptions.push({
                    label: 'Install to Workspace (.github/agents)',
                    description: defaultPath,
                    detail: 'Standard workspace agent location'
                });
            }
        }

        // 2. User Profile option (derived from globalStorageUri)
        // context.globalStorageUri points to .../User/globalStorage/publisher.extension
        // We want .../User/prompts
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        const userDir = path.dirname(path.dirname(globalStoragePath));
        const userPath = path.join(userDir, 'prompts');

        installOptions.push({
            label: 'Install to User Profile (prompts)',
            description: userPath,
            detail: 'Available globally across all workspaces'
        });

        const selection = await vscode.window.showQuickPick(installOptions, {
            placeHolder: `Where do you want to install ${agent.name}?`
        });

        if (!selection) {
            return;
        }

        let installPath: string;
        const fileName = path.basename(agent.path); // Use the original filename from the repo

        if (selection.description) {
            installPath = path.join(selection.description, fileName);
        } else {
            // Fallback
            return;
        }

        try {
            await this.downloadFile(agent.installUrl, installPath);
            vscode.window.showInformationMessage(`Agent ${agent.name} installed successfully to ${installPath}`);

            // Open the file
            const doc = await vscode.workspace.openTextDocument(installPath);
            await vscode.window.showTextDocument(doc);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install agent: ${error}`);
        }
    }

    private async downloadFile(url: string, destPath: string): Promise<void> {
        // Ensure directory exists
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(destPath, () => { }); // Delete the file async. (But we don't check result)
                reject(err);
            });
        });
    }
}
