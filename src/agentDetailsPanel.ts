import * as vscode from 'vscode';
import { TelemetryService } from './telemetry';
import { Agent } from './agentDiscovery';
import { AgentInstaller } from './agentInstaller';
import { GithubApi } from './githubApi';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class AgentDetailsPanel {
    // ...
    private fetchUrl(url: string): Promise<string> {
        return GithubApi.fetch(url);
    }

    private async fetchLastUpdated(agent: Agent) {
        const repoRegex = /github\.com\/([^\/]+)\/([^\/]+)/;
        const match = agent.repository.match(repoRegex);
        if (!match) { return; }

        const owner = match[1];
        const repo = match[2];

        let path = '';
        const rawRegex = /raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/[^\/]+\/(.+)/;
        const pathMatch = agent.installUrl.match(rawRegex);
        if (pathMatch) {
            path = pathMatch[1];
        }

        if (!path) { return; }

        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${path}&page=1&per_page=1`;

        try {
            const data = await GithubApi.fetch(apiUrl);
            const commits = JSON.parse(data);
            if (Array.isArray(commits) && commits.length > 0) {
                const date = commits[0].commit.author.date;
                const formattedDate = new Date(date).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                this._panel.webview.postMessage({ command: 'updateDate', date: formattedDate });
            }
        } catch (e) {
            console.error('Error fetching commit date:', e);
            TelemetryService.getInstance().sendError(e as Error, { context: 'fetchLastUpdated', agent: agent.name });
        }
    }
    public static currentPanel: AgentDetailsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _agent: Agent;

    public static createOrShow(context: vscode.ExtensionContext, agent: Agent, searchTerm?: string) {
        console.log('AgentDetailsPanel.createOrShow called for:', agent.name);
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (AgentDetailsPanel.currentPanel) {
            AgentDetailsPanel.currentPanel._panel.reveal(column);
            AgentDetailsPanel.currentPanel.update(agent, searchTerm);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'agentDetails',
            agent.name,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')]
            }
        );

        AgentDetailsPanel.currentPanel = new AgentDetailsPanel(panel, context, agent, searchTerm);
    }

    private constructor(panel: vscode.WebviewPanel, private context: vscode.ExtensionContext, agent: Agent, searchTerm?: string) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._agent = agent;

        // Set the webview's initial html content
        this.update(agent, searchTerm);

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'install':
                        vscode.commands.executeCommand('agentManager.install', { agent: this._agent });
                        return;
                    case 'viewDidLoad':
                        // Webview reported it is ready (reloaded or first load)
                        this.fetchLastUpdated(this._agent);
                        this.checkInstallationStatus(this._agent);
                        // Fetch content
                        try {
                            const content = await this.fetchUrl(this._agent.installUrl);
                            this._panel.webview.postMessage({ command: 'updateContent', content });
                        } catch (e) {
                            TelemetryService.getInstance().sendError(e as Error, { context: 'fetchContent', agent: this._agent.name });
                            this._panel.webview.postMessage({ command: 'updateContent', content: 'Failed to load content: ' + e });
                        }
                        return;
                    case 'showDiff':
                        const localPath = message.localPath;
                        if (!localPath) { return; }

                        try {
                            const agent = this._agent;
                            TelemetryService.getInstance().sendEvent('diff.show', { agent: agent.name });
                            const remoteContent = await this.fetchUrl(agent.installUrl);

                            // Create a temporary file or virtual document for remote content
                            const remoteUri = vscode.Uri.parse(`untitled:${agent.name}_remote.md`);
                            const doc = await vscode.workspace.openTextDocument(remoteUri);

                            // Clear and set content using WorkspaceEdit
                            const edit = new vscode.WorkspaceEdit();
                            // If doc has content, replace it. 
                            const fullRange = new vscode.Range(
                                doc.lineAt(0).range.start,
                                doc.lineAt(doc.lineCount - 1).range.end
                            );
                            edit.replace(remoteUri, fullRange, remoteContent);
                            await vscode.workspace.applyEdit(edit);

                            // If the document was empty (newly created), applyEdit might not replace anything if range is empty?
                            // Actually untitled docs start empty. So we can just insert.
                            if (doc.getText() === '') {
                                const insertEdit = new vscode.WorkspaceEdit();
                                insertEdit.insert(remoteUri, new vscode.Position(0, 0), remoteContent);
                                await vscode.workspace.applyEdit(insertEdit);
                            }

                            // Open Diff
                            await vscode.commands.executeCommand('vscode.diff',
                                vscode.Uri.file(localPath),
                                remoteUri,
                                `${agent.name} (Local) ↔ (Remote)`
                            );
                        } catch (error) {
                            TelemetryService.getInstance().sendError(error as Error, { context: 'showDiff', agent: this._agent.name });
                            vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public update(agent: Agent, searchTerm?: string) {
        this._agent = agent;
        this._panel.title = agent.name;
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, agent, searchTerm);
        this.fetchLastUpdated(agent);
        this.checkInstallationStatus(agent);
    }

    private async checkInstallationStatus(agent: Agent) {
        let localPath: string | undefined;

        // Check workspace with prioritized locations from chat.agentFilesLocations
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('chat');
            const locations = config.get<string[]>('agentFilesLocations') || [];

            // Add default location to the check list if not explicitly present (though priority implies explicit config first)
            // But let's check config first, then default.
            const pathsToCheck = [...locations];
            if (!pathsToCheck.includes('.github/agents')) {
                pathsToCheck.push('.github/agents');
            }

            for (const loc of pathsToCheck) {
                const fileName = path.basename(agent.path); // Use original filename
                const fullPath = path.isAbsolute(loc) ? path.join(loc, fileName) : path.join(workspaceRoot, loc, fileName);

                if (fs.existsSync(fullPath)) {
                    localPath = fullPath;
                    break; // Found it
                }

                // Fallback check with agent name just in case (though we should avoid this)
                // const fallbackPath = ...
            }
        }

        // Check global if not in workspace
        if (!localPath) {
            // Check User/prompts
            const globalStoragePath = this.context.globalStorageUri.fsPath;
            // globalStorageUri points to .../User/globalStorage/publisher.extension
            // We want .../User/prompts
            const userDir = path.dirname(path.dirname(globalStoragePath));
            const fileName = path.basename(agent.path);
            const p = path.join(userDir, 'prompts', fileName);

            if (fs.existsSync(p)) {
                localPath = p;
            }
        }

        if (!localPath) {
            this._panel.webview.postMessage({ command: 'updateStatus', status: 'not-installed' });
            return;
        }

        try {
            const localContent = fs.readFileSync(localPath, 'utf8');
            const remoteContent = await this.fetchUrl(agent.installUrl);

            if (localContent === remoteContent) {
                this._panel.webview.postMessage({ command: 'updateStatus', status: 'installed', localPath });
            } else {
                this._panel.webview.postMessage({ command: 'updateStatus', status: 'update-available', localPath });
            }
        } catch (e) {
            console.error('Failed to compare installation status', e);
            TelemetryService.getInstance().sendError(e as Error, { context: 'checkInstallationStatus', agent: agent.name });
        }
    }



    public dispose() {
        AgentDetailsPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, agent: Agent, searchTerm?: string) {
        // Use a Content Security Policy
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'style.css')); // We can create this later if needed

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${agent.name}</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); }
                    h1 { font-size: 1.5em; margin-bottom: 0.5em; }
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
                <h1>${agent.name}</h1>
                <div class="meta">
                    <p><strong>Repository:</strong> <a href="${agent.repository}">${agent.repository}</a></p>
                    <p id="last-updated"><strong>Last Updated:</strong> Loading...</p>
                    <p id="install-status"><strong>Status:</strong> Checking...</p>
                </div>
                
                <div class="actions">
                    <button id="install-btn" onclick="install()" style="display:none;">Install Agent</button>
                    <button id="update-btn" onclick="install()" style="display:none;">Update Agent</button>
                    <button id="diff-btn" onclick="showDiff()" style="display:none; margin-left: 10px;">Show Changes</button>
                    <span id="installed-msg" style="display:none; color: var(--vscode-notebookStatusSuccessIcon-foreground);">✔ Installed (Up to date)</span>
                </div>

                <hr/>
                
                <h2>Content Preview</h2>
                <div class="content" id="content">Loading content...</div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentLocalPath = '';
                    const searchTerm = "${searchTerm || ''}";
                    
                    function install() {
                        vscode.postMessage({ command: 'install' });
                    }

                    function showDiff() {
                        if (currentLocalPath) {
                            vscode.postMessage({ command: 'showDiff', localPath: currentLocalPath });
                        }
                    }

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
                                        // Simple HTML escaping
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
                            return string.replace(/[.*+?^!:"{}()|[\\]\\\\]/g, '\\\\$&'); // $& means the whole matched string
                        }
    
                        function highlightText(text, term) {
                             if (!term) return text;
                             const regex = new RegExp('(' + escapeRegExp(term) + ')', 'gi');
                             return text.replace(regex, '<mark>$1</mark>');
                        }

                    // Notify extension that the view has loaded
                    vscode.postMessage({ command: 'viewDidLoad' });
                </script>
            </body>
            </html>`;
    }
}
