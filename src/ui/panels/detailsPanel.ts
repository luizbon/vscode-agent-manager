import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { TelemetryService } from '../../services/telemetry';
import { IMarketplaceItem } from '../../domain/models/marketplaceItem';

export class DetailsPanel {
    private fetchUrl(url: string): Promise<string> {
        return fs.promises.readFile(url, 'utf-8');
    }

    private async fetchLastUpdated(item: IMarketplaceItem) {
        try {
            const filePath = item.installUrl;
            if (!fs.existsSync(filePath)) { return; }

            const dir = path.dirname(filePath);
            execFile('git', ['log', '-1', '--format=%cI', filePath], { cwd: dir }, (error: any, stdout: string) => {
                let dateToUse = new Date();
                if (!error && stdout.trim()) {
                    dateToUse = new Date(stdout.trim());
                } else {
                    const stat = fs.statSync(filePath);
                    dateToUse = stat.mtime;
                }
                const formattedDate = dateToUse.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                this._panel.webview.postMessage({ command: 'updateDate', date: formattedDate });
            });
        } catch (e) {
            console.error('Error fetching commit date:', e);
            TelemetryService.getInstance().sendError(e as Error, { context: 'fetchLastUpdated', item: item.name });
        }
    }

    public static currentPanel: DetailsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _item: IMarketplaceItem;

    public static createOrShow(context: vscode.ExtensionContext, item: IMarketplaceItem, searchTerm?: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DetailsPanel.currentPanel) {
            DetailsPanel.currentPanel._panel.reveal(column);
            DetailsPanel.currentPanel.update(item, searchTerm);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'marketplaceDetails',
            item.name,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')]
            }
        );

        DetailsPanel.currentPanel = new DetailsPanel(panel, context, item, searchTerm);
    }

    private constructor(panel: vscode.WebviewPanel, private context: vscode.ExtensionContext, item: IMarketplaceItem, searchTerm?: string) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._item = item;

        this.update(item, searchTerm);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'install':
                        vscode.commands.executeCommand('marketplace.install', this._item);
                        return;
                    case 'viewDidLoad':
                        this.fetchLastUpdated(this._item);
                        this.checkInstallationStatus(this._item);
                        try {
                            const content = await this.fetchUrl(this._item.installUrl);
                            this._panel.webview.postMessage({ command: 'updateContent', content });
                        } catch (e) {
                            TelemetryService.getInstance().sendError(e as Error, { context: 'fetchContent', item: this._item.name });
                            this._panel.webview.postMessage({ command: 'updateContent', content: 'Failed to load content: ' + e });
                        }
                        return;
                    case 'showDiff':
                        const localPath = message.localPath;
                        if (!localPath) { return; }

                        try {
                            const item = this._item;
                            TelemetryService.getInstance().sendEvent('diff.show', { item: item.name });
                            const remoteContent = await this.fetchUrl(item.installUrl);

                            const remoteUri = vscode.Uri.parse(`untitled:${item.name}_remote.md`);
                            const doc = await vscode.workspace.openTextDocument(remoteUri);

                            const edit = new vscode.WorkspaceEdit();
                            const fullRange = new vscode.Range(
                                doc.lineAt(0).range.start,
                                doc.lineAt(doc.lineCount - 1).range.end
                            );
                            edit.replace(remoteUri, fullRange, remoteContent);
                            await vscode.workspace.applyEdit(edit);

                            if (doc.getText() === '') {
                                const insertEdit = new vscode.WorkspaceEdit();
                                insertEdit.insert(remoteUri, new vscode.Position(0, 0), remoteContent);
                                await vscode.workspace.applyEdit(insertEdit);
                            }

                            await vscode.commands.executeCommand('vscode.diff',
                                vscode.Uri.file(localPath),
                                remoteUri,
                                `${item.name} (Local) ↔ (Remote)`
                            );
                        } catch (error) {
                            TelemetryService.getInstance().sendError(error as Error, { context: 'showDiff', item: this._item.name });
                            vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public update(item: IMarketplaceItem, searchTerm?: string) {
        this._item = item;
        this._panel.title = item.name;
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, item, searchTerm);
        this.fetchLastUpdated(item);
        this.checkInstallationStatus(item);
    }

    private async checkInstallationStatus(item: IMarketplaceItem) {
        let localPath: string | undefined;

        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('chat');
            const settingName = item.type === 'agent' ? 'agentFilesLocations' : 'agentSkillsLocations';
            const configLocations = config.get<string[]>(settingName);

            const locations: string[] = [];
            if (Array.isArray(configLocations)) {
                for (let i = 0; i < configLocations.length; i++) {
                    locations.push(configLocations[i]);
                }
            }

            const pathsToCheck = [...locations];
            const defaultLoc = item.type === 'agent' ? '.github/agents' : '.github/skills';
            if (!pathsToCheck.includes(defaultLoc)) {
                pathsToCheck.push(defaultLoc);
            }

            for (const loc of pathsToCheck) {
                const fileName = path.basename(item.path);
                const fullPath = path.isAbsolute(loc) ? path.join(loc, fileName) : path.join(workspaceRoot, loc, fileName);

                if (fs.existsSync(fullPath)) {
                    localPath = fullPath;
                    break;
                }
            }
        }

        if (!localPath) {
            const fileName = path.basename(item.path);
            if (item.type === 'agent') {
                const globalStoragePath = this.context.globalStorageUri.fsPath;
                const userDir = path.dirname(path.dirname(globalStoragePath));
                const p = path.join(userDir, 'prompts', fileName);
                if (fs.existsSync(p)) {
                    localPath = p;
                }
            } else {
                const globalSkillPath = path.join(os.homedir(), '.copilot', 'skills');
                const p = path.join(globalSkillPath, fileName);
                if (fs.existsSync(p)) {
                    localPath = p;
                }
            }
        }

        if (!localPath) {
            this._panel.webview.postMessage({ command: 'updateStatus', status: 'not-installed' });
            return;
        }

        try {
            const localContent = fs.readFileSync(localPath, 'utf8');
            const remoteContent = await this.fetchUrl(item.installUrl);

            if (localContent === remoteContent) {
                this._panel.webview.postMessage({ command: 'updateStatus', status: 'installed', localPath });
            } else {
                this._panel.webview.postMessage({ command: 'updateStatus', status: 'update-available', localPath });
            }
        } catch (e) {
            console.error('Failed to compare installation status', e);
            TelemetryService.getInstance().sendError(e as Error, { context: 'checkInstallationStatus', item: item.name });
        }
    }

    public dispose() {
        DetailsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private escapeHtml(unsafe: string | undefined): string {
        if (!unsafe) { return ''; }
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private _getHtmlForWebview(webview: vscode.Webview, item: IMarketplaceItem, searchTerm?: string) {
        const nonce = this.getNonce();
        const safeName = this.escapeHtml(item.name);
        const safeRepo = this.escapeHtml(item.repository);
        const itemType = item.type === 'agent' ? 'Agent' : 'Skill';

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${safeName}</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); }
                    h1 { font-size: 1.5em; margin-bottom: 0.5em; display: flex; align-items: center; gap: 10px; }
                    .badge { font-size: 0.6em; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: bold; }
                    .badge-agent { background-color: #007acc; color: white; }
                    .badge-skill { background-color: #2ea043; color: white; }
                    .meta { margin-bottom: 20px; color: var(--vscode-descriptionForeground); }
                    .actions { margin-bottom: 20px; }
                    button { 
                        background-color: var(--vscode-button-background); 
                        color: var(--vscode-button-foreground); 
                        border: none; 
                        padding: 8px 16px; 
                        cursor: pointer; 
                        font-size: 1em;
                    }
                    button:hover { background-color: var(--vscode-button-hoverBackground); }
                    .content { 
                        background-color: var(--vscode-editor-background); 
                        padding: 10px; 
                        border: 1px solid var(--vscode-widget-border);
                        white-space: pre-wrap; 
                        font-family: var(--vscode-editor-font-family);
                    }
                </style>
            </head>
            <body>
                <h1>
                    <span class="badge ${item.type === 'agent' ? 'badge-agent' : 'badge-skill'}">${itemType}</span>
                    ${safeName}
                </h1>
                <div class="meta">
                    <p><strong>Repository:</strong> <a href="${safeRepo}">${safeRepo}</a></p>
                    <p id="last-updated"><strong>Last Updated:</strong> Loading...</p>
                    <p id="install-status"><strong>Status:</strong> Checking...</p>
                </div>
                
                <div class="actions">
                    <button id="install-btn" style="display:none;">Install ${itemType}</button>
                    <button id="update-btn" style="display:none;">Update ${itemType}</button>
                    <button id="diff-btn" style="display:none; margin-left: 10px;">Show Changes</button>
                    <span id="installed-msg" style="display:none; color: var(--vscode-notebookStatusSuccessIcon-foreground);">✔ Installed (Up to date)</span>
                </div>

                <hr/>
                
                <h2>Content Preview</h2>
                <div class="content" id="content">Loading content...</div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    let currentLocalPath = '';
                    const searchTerm = "${searchTerm || ''}";
                    
                    function install() { vscode.postMessage({ command: 'install' }); }

                    function showDiff() {
                        if (currentLocalPath) {
                            vscode.postMessage({ command: 'showDiff', localPath: currentLocalPath });
                        }
                    }

                    const installBtnEl = document.getElementById('install-btn');
                    const updateBtnEl = document.getElementById('update-btn');
                    const diffBtnEl = document.getElementById('diff-btn');
                    
                    if (installBtnEl) installBtnEl.addEventListener('click', install);
                    if (updateBtnEl) updateBtnEl.addEventListener('click', install);
                    if (diffBtnEl) diffBtnEl.addEventListener('click', showDiff);

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateDate':
                                const dateEl = document.getElementById('last-updated');
                                if (dateEl) {
                                    dateEl.innerHTML = '<strong>Last Updated:</strong> ' + message.date;
                                }
                                break;
                            case 'updateStatus':
                                const statusEl = document.getElementById('install-status');
                                const installBtn = document.getElementById('install-btn');
                                const updateBtn = document.getElementById('update-btn');
                                const diffBtn = document.getElementById('diff-btn');
                                const installedMsg = document.getElementById('installed-msg');

                                if (message.status === 'installed') {
                                    statusEl.innerHTML = '<strong>Status:</strong> Installed (Up to date)';
                                    installedMsg.style.display = 'inline';
                                    installBtn.style.display = 'none';
                                    updateBtn.style.display = 'none';
                                    diffBtn.style.display = 'none';
                                } else if (message.status === 'update-available') {
                                    statusEl.innerHTML = '<strong>Status:</strong> New version available';
                                    installedMsg.style.display = 'none';
                                    installBtn.style.display = 'none';
                                    updateBtn.style.display = 'inline-block';
                                    diffBtn.style.display = 'inline-block';
                                    currentLocalPath = message.localPath;
                                } else {
                                    statusEl.innerHTML = '<strong>Status:</strong> Not Installed';
                                    installedMsg.style.display = 'none';
                                    installBtn.style.display = 'inline-block';
                                    updateBtn.style.display = 'none';
                                    diffBtn.style.display = 'none';
                                }
                                break;
                            case 'updateContent':
                                    const contentDiv = document.getElementById('content');
                                    if (contentDiv) {
                                        let text = message.content;
                                        let safeText = text.replace(/&/g, "&amp;")
                                            .replace(/</g, "&lt;")
                                            .replace(/>/g, "&gt;")
                                            .replace(/"/g, "&quot;")
                                            .replace(/'/g, "&#039;");

                                        if (searchTerm) {
                                            contentDiv.innerHTML = highlightText(safeText, searchTerm);
                                        } else {
                                            contentDiv.textContent = text;
                                        }
                                    }
                                    break;
                            }
                        });
    
                        function escapeRegExp(string) {
                            const pattern = '[.*+?^$' + '{}()|[\\\\\\]\\\\\\\\]';
                            return string.replace(new RegExp(pattern, 'g'), '\\\\$&');
                        }
    
                        function highlightText(text, term) {
                             if (!term) return text;
                             const regex = new RegExp('(' + escapeRegExp(term) + ')', 'gi');
                             return text.replace(regex, '<mark>$1</mark>');
                        }

                    vscode.postMessage({ command: 'viewDidLoad' });
                </script>
            </body>
            </html>`;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
