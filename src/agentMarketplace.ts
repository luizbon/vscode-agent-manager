import * as vscode from 'vscode';
import { Agent } from './agentDiscovery';

export class AgentMarketplaceProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'agentManagerMarketplace';

    private _view?: vscode.WebviewView;
    private _agents: Agent[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'installAgent':
                    vscode.commands.executeCommand('agentManager.install', data.agent);
                    break;
                case 'viewDetails':
                    vscode.commands.executeCommand('agentManager.openAgentDetails', data.agent, data.searchTerm);
                    break;
                case 'uninstallAgent':
                    vscode.commands.executeCommand('agentManager.uninstall', data.agent);
                    break;
                case 'search':
                    // Trigger search in extension? Or just filter locally?
                    // The user might want to re-fetch from repositories.
                    // For now, let's assume search filters the current list, 
                    // but maybe we can trigger a re-fetch if it's a global search?
                    // The original "Refresh" button did a re-fetch.
                    vscode.commands.executeCommand('agentManager.search', data.force);
                    break;
                case 'viewDidLoad':
                    // Send cached agents immediately
                    if (this._agents.length > 0) {
                        this._view?.webview.postMessage({ type: 'updateAgents', agents: this._agents, installedAgents: [] }); // We need installedAgents here too...
                        // Re-trigger search (cached) to get installedAgents passed properly or update this method
                        vscode.commands.executeCommand('agentManager.search', false);
                    } else {
                        vscode.commands.executeCommand('agentManager.search', false);
                    }
                    break;
            }
        });
    }

    public updateAgents(agents: Agent[], installedAgents: Agent[] = []) {
        this._agents = agents;
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateAgents', agents: agents, installedAgents: installedAgents });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        // const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

        // Do the same for the stylesheet.
        // const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
        // const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
        // const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${codiconsUri}" rel="stylesheet" />
				<title>Agent Marketplace</title>
                <style>
                    body {
                        padding: 10px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .header {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        margin-bottom: 20px;
                    }
                    .search-box {
                        display: flex;
                        gap: 10px;
                    }
                    input[type="text"] {
                        flex: 1;
                        padding: 8px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 12px;
                        cursor: pointer;
                        border-radius: 2px;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                        gap: 15px;
                    }
                    .card {
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                        padding: 15px;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        transition: box-shadow 0.2s;
                    }
                    .card:hover {
                        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                        border-color: var(--vscode-focusBorder);
                    }
                    .card-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .card-title {
                        font-weight: bold;
                        font-size: 1.1em;
                        margin: 0;
                    }
                    .card-version {
                        font-size: 0.8em;
                        color: var(--vscode-descriptionForeground);
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 6px;
                        border-radius: 10px;
                    }
                    .card-desc {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                        flex: 1;
                        display: -webkit-box;
                        -webkit-line-clamp: 3;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                    }
                    .tags {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 5px;
                    }
                    .tag {
                        font-size: 0.8em;
                        background-color: var(--vscode-textBlockQuote-background);
                        padding: 2px 6px;
                        border-radius: 4px;
                    }
                    .actions {
                        display: flex;
                        gap: 10px;
                        margin-top: 10px;
                    }
                    .actions button {
                        flex: 1;
                    }
                    .install-btn {
                        background-color: var(--vscode-button-background);
                    }
                    .uninstall-btn {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-errorForeground);
                        border: 1px solid var(--vscode-errorForeground);
                    }
                    .uninstall-btn:hover {
                         background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    .details-btn {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                </style>
			</head>
			<body>
                <div class="header">
                    <div class="search-box">
                        <input type="text" id="search-input" placeholder="Filter agents..." />
                    </div>
                </div>
                <div id="results-container" class="grid">
                    <!-- Cards will be injected here -->
                    <div style="text-align: center; width: 100%; grid-column: 1/-1; padding: 20px;">
                        Loading agents... or click Refresh.
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    
                    const container = document.getElementById('results-container');
                    const searchInput = document.getElementById('search-input');
                    // const searchBtn = document.getElementById('search-btn'); // Removed

                    let allAgents = [];
                    let installedAgentNames = new Set();
                    let debounceTimer;

                    /* 
                    searchBtn.addEventListener('click', () => {
                         vscode.postMessage({ type: 'search', force: false });
                    });
                    */

                    searchInput.addEventListener('input', (e) => {
                        const term = e.target.value.toLowerCase();
                        
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            renderAgents(allAgents.filter(a => 
                                a.name.toLowerCase().includes(term) || 
                                (a.description && a.description.toLowerCase().includes(term)) ||
                                (a.tags && a.tags.some(t => t.toLowerCase().includes(term)))
                            ));
                        }, 300); // 300ms debounce
                    });

                    // Notify extension that the view has loaded
                    vscode.postMessage({ type: 'viewDidLoad' });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'updateAgents':
                                allAgents = message.agents;
                                if (message.installedAgents) {
                                    installedAgentNames = new Set(message.installedAgents.map(a => a.name));
                                }
                                
                                // Re-apply current filter
                                const term = searchInput.value.toLowerCase();
                                if (term) {
                                    renderAgents(allAgents.filter(a => 
                                        a.name.toLowerCase().includes(term) || 
                                        (a.description && a.description.toLowerCase().includes(term)) ||
                                        (a.tags && a.tags.some(t => t.toLowerCase().includes(term)))
                                    ));
                                } else {
                                    renderAgents(allAgents);
                                }
                                break;
                        }
                    });

                    function renderAgents(agents) {
                        container.innerHTML = '';
                        if (agents.length === 0) {
                            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center;">No agents found.</div>';
                            return;
                        }

                        agents.forEach(agent => {
                            const isInstalled = installedAgentNames.has(agent.name);
                            const card = document.createElement('div');
                            card.className = 'card';
                            
                            const tagsHtml = (agent.tags || []).slice(0, 3).map(tag => \`<span class="tag">\${tag}</span>\`).join('');
                            
                            // Clean description quotes
                            let cleanDesc = agent.description || 'No description';
                            cleanDesc = cleanDesc.replace(/^['"]+|['"]+$/g, '');

                            let actionButtons = '';
                            if (isInstalled) {
                                actionButtons = \`
                                    <button class="uninstall-btn">Uninstall</button>
                                    <button class="details-btn">Details</button>
                                \`;
                            } else {
                                actionButtons = \`
                                    <button class="install-btn">Install</button>
                                    <button class="details-btn">Details</button>
                                \`;
                            }

                            card.innerHTML = \`
                                <div class="card-header">
                                    <h3 class="card-title">\${agent.name}</h3>
                                    \${agent.version ? \`<span class="card-version">v\${agent.version}</span>\` : ''}
                                </div>
                                <div class="card-desc" title="\${cleanDesc}">\${cleanDesc}</div>
                                <div class="tags">\${tagsHtml}</div>
                                <div class="actions">
                                    \${actionButtons}
                                </div>
                            \`;

                            if (isInstalled) {
                                card.querySelector('.uninstall-btn').addEventListener('click', () => {
                                    vscode.postMessage({ type: 'uninstallAgent', agent: agent });
                                });
                            } else {
                                card.querySelector('.install-btn').addEventListener('click', () => {
                                    vscode.postMessage({ type: 'installAgent', agent: agent });
                                });
                            }

                            card.querySelector('.details-btn').addEventListener('click', () => {
                                vscode.postMessage({ type: 'viewDetails', agent: agent, searchTerm: searchInput.value });
                            });

                            container.appendChild(card);
                        });
                    }
                </script>
			</body>
			</html>`;
    }
}
