import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from './agentDiscovery';
import { GitService } from './gitService';

export class AgentInstaller {
    constructor(private context: vscode.ExtensionContext) { }

    public async installAgent(agent: Agent, targetPath?: string) {
        const installOptions: vscode.QuickPickItem[] = [];

        if (targetPath) {
            // Direct update/overwrite
            try {
                const basePath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.base`);

                // Do we need to 3-way merge?
                if (fs.existsSync(basePath) && fs.existsSync(targetPath)) {
                    const currentContent = await fs.promises.readFile(targetPath, 'utf-8');
                    const baseContent = await fs.promises.readFile(basePath, 'utf-8');

                    if (currentContent !== baseContent) {
                        // User modified the file locally
                        const gitService = new GitService();
                        const targetBackup = targetPath + '.bak';
                        await fs.promises.copyFile(targetPath, targetBackup); // Backup user's work

                        const success = await gitService.mergeUpdate(targetPath, basePath, agent.installUrl);
                        if (!success) {
                            // File has conflict markers now
                            const doc = await vscode.workspace.openTextDocument(targetPath);
                            await vscode.window.showTextDocument(doc);

                            const choice = await vscode.window.showWarningMessage(
                                `Conflicts found while updating ${agent.name}. Please review the conflict markers in the file.`,
                                { modal: true },
                                'Override', 'Keep Merged / Fix Manually', 'Cancel'
                            );

                            if (choice === 'Cancel') {
                                // Restore backup
                                await fs.promises.copyFile(targetBackup, targetPath);
                                await fs.promises.unlink(targetBackup).catch(() => { });
                                vscode.window.showInformationMessage('Update cancelled.');
                                return;
                            } else if (choice === 'Override') {
                                // Overwrite completely
                                await this.copyAgentFile(agent.installUrl, targetPath);
                            }
                        }

                        // Clean up backup if not cancelled
                        await fs.promises.unlink(targetBackup).catch(() => { });
                    } else {
                        // User didn't modify it, just overwrite
                        await this.copyAgentFile(agent.installUrl, targetPath);
                    }
                } else {
                    // No base file or target missing, just overwrite
                    await this.copyAgentFile(agent.installUrl, targetPath);
                }

                // Update the base file
                await this.copyAgentFile(agent.installUrl, basePath);

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
            await this.copyAgentFile(agent.installUrl, installPath);
            const basePath = path.join(path.dirname(installPath), `.${path.basename(installPath)}.base`);
            await this.copyAgentFile(agent.installUrl, basePath);

            vscode.window.showInformationMessage(`Agent ${agent.name} installed successfully to ${installPath}`);

            // Open the file
            const doc = await vscode.workspace.openTextDocument(installPath);
            await vscode.window.showTextDocument(doc);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install agent: ${error}`);
        }
    }

    private async copyAgentFile(sourcePath: string, destPath: string): Promise<void> {
        // Ensure directory exists
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.copyFile(sourcePath, destPath);
    }
}
