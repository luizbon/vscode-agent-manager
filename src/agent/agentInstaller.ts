import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from './agentDiscovery';
import { GitService } from '../services/gitService';

export class AgentInstaller {
    constructor(private context: vscode.ExtensionContext) { }

    private getStateKey(installPath: string): string {
        return `agentSha:${installPath}`;
    }

    private async getState(key: string, isGlobal: boolean): Promise<string | undefined> {
        if (isGlobal) {
            return this.context.globalState.get<string>(key);
        } else {
            return this.context.workspaceState.get<string>(key);
        }
    }

    private async updateState(key: string, value: string, isGlobal: boolean): Promise<void> {
        if (isGlobal) {
            await this.context.globalState.update(key, value);
        } else {
            await this.context.workspaceState.update(key, value);
        }
    }

    public async installAgent(agent: Agent, targetPath?: string) {
        const installOptions: vscode.QuickPickItem[] = [];

        const globalStoragePath = this.context.globalStorageUri.fsPath;
        const userDir = path.dirname(path.dirname(globalStoragePath));
        const userPath = path.join(userDir, 'prompts');

        const isUserGlobal = (pathToCheck: string) => pathToCheck.startsWith(userPath);

        const gitService = new GitService();
        let repoRoot = '';
        let currentSha = '';
        let relativePath = '';
        try {
            repoRoot = await gitService.getRepoRoot(agent.installUrl);
            currentSha = await gitService.getHeadSha(repoRoot);
            relativePath = path.relative(repoRoot, agent.installUrl);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to determine git details for agent: ${e}`);
            return;
        }

        if (targetPath) {
            // Direct update/overwrite
            try {
                const isGlobal = isUserGlobal(targetPath);
                const stateKey = this.getStateKey(targetPath);
                let baseSha = await this.getState(stateKey, isGlobal);

                const hasLocalFile = fs.existsSync(targetPath);

                // Fallback for existing installations using legacy .base files
                const legacyBasePath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.base`);
                const hasLegacyBase = fs.existsSync(legacyBasePath);

                if ((baseSha || hasLegacyBase) && hasLocalFile) {
                    const currentContent = await fs.promises.readFile(targetPath, 'utf-8');
                    let baseContent = '';

                    if (baseSha) {
                        try {
                            baseContent = await gitService.getFileContentAtSha(repoRoot, baseSha, relativePath);
                        } catch (e) {
                            baseContent = currentContent;
                        }
                    } else if (hasLegacyBase) {
                        baseContent = await fs.promises.readFile(legacyBasePath, 'utf-8');
                    }

                    const newContent = await fs.promises.readFile(agent.installUrl, 'utf-8');

                    // Temporary files for git merge-file which requires files on disk
                    const baseTempPath = path.join(os.tmpdir(), `base_${Date.now()}_${path.basename(targetPath)}`);
                    const newTempPath = path.join(os.tmpdir(), `new_${Date.now()}_${path.basename(targetPath)}`);

                    if (currentContent !== baseContent) {
                        // User modified the file locally
                        const targetBackup = targetPath + '.bak';
                        await fs.promises.copyFile(targetPath, targetBackup); // Backup user's work

                        await fs.promises.writeFile(baseTempPath, baseContent, 'utf-8');
                        await fs.promises.writeFile(newTempPath, newContent, 'utf-8');

                        const success = await gitService.mergeUpdate(targetPath, baseTempPath, newTempPath);

                        await fs.promises.unlink(baseTempPath).catch(() => { });
                        await fs.promises.unlink(newTempPath).catch(() => { });

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
                    // No base file state or target missing, just overwrite
                    await this.copyAgentFile(agent.installUrl, targetPath);
                }

                // Update the state
                await this.updateState(this.getStateKey(targetPath), currentSha, isUserGlobal(targetPath));

                // Cleanup old base file if it exists
                if (hasLegacyBase) {
                    await fs.promises.unlink(legacyBasePath).catch(() => { });
                }

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
            const configLocations = config.get<string[]>('agentFilesLocations');
            const locations: string[] = [];
            if (Array.isArray(configLocations)) {
                for (let i = 0; i < configLocations.length; i++) {
                    locations.push(configLocations[i]);
                }
            }

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
            await this.updateState(this.getStateKey(installPath), currentSha, isUserGlobal(installPath));

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
