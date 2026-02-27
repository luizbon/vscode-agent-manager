import * as vscode from "vscode";
import { Agent } from "../../domain/models/agent";
import { Skill } from "../../domain/models/skill";

type MarketplaceData = { agents: Agent[]; skills: Skill[] };

export class MarketplaceWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "agentManagerMarketplace";

    private _view?: vscode.WebviewView;
    private _data: MarketplaceData = { agents: [], skills: [] };
    private _installedData: MarketplaceData = { agents: [], skills: [] };

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case "installItem":
                    vscode.commands.executeCommand("marketplace.install", message.item);
                    break;
                case "viewDetails":
                    vscode.commands.executeCommand(
                        "marketplace.openDetails",
                        message.item,
                        message.searchTerm,
                    );
                    break;
                case "uninstallItem":
                    vscode.commands.executeCommand("marketplace.uninstall", message.item);
                    break;
                case "search":
                    vscode.commands.executeCommand("marketplace.search", message.force);
                    break;
                case "viewDidLoad":
                    if (this._data.agents.length > 0 || this._data.skills.length > 0) {
                        this.updateItems(this._data, this._installedData);
                    } else {
                        vscode.commands.executeCommand("marketplace.search", false);
                    }
                    break;
            }
        });
    }

    public updateItems(data: MarketplaceData, installedData: MarketplaceData = { agents: [], skills: [] }) {
        this._data = data;
        this._installedData = installedData;

        if (this._view) {
            this._view.webview.postMessage({
                type: "updateItems",
                data: data,
                installedData: installedData,
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css",
            ),
        );
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${codiconsUri}" rel="stylesheet" />
				<title>Marketplace</title>
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
                    .controls-row {
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
                    select {
                        padding: 8px;
                        background-color: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
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
                    .card-title-container {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .card-title {
                        font-weight: bold;
                        font-size: 1.1em;
                        margin: 0;
                    }
                    .item-type-badge {
                        font-size: 0.7em;
                        text-transform: uppercase;
                        padding: 2px 4px;
                        border-radius: 3px;
                        font-weight: bold;
                    }
                    .type-agent { background-color: #007acc; color: white; }
                    .type-skill { background-color: #2ea043; color: white; }
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
                    <div class="controls-row">
                        <select id="type-filter">
                            <option value="all">All Types</option>
                            <option value="agent">Agents Only</option>
                            <option value="skill">Skills Only</option>
                        </select>
                        <input type="text" id="search-input" placeholder="Filter by name, description, tags..." />
                    </div>
                </div>
                <div id="results-container" class="grid">
                    <div style="text-align: center; width: 100%; grid-column: 1/-1; padding: 20px;">
                        Loading...
                    </div>
                </div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    const container = document.getElementById('results-container');
                    const searchInput = document.getElementById('search-input');
                    const typeFilter = document.getElementById('type-filter');

                    let allItems = [];
                    let installedItemIds = new Set();
                    let debounceTimer;

                    function applyFilters() {
                        const term = searchInput.value.toLowerCase();
                        const filterType = typeFilter.value;
                        
                        let filtered = allItems;
                        
                        if (filterType !== 'all') {
                            filtered = filtered.filter(i => i.type === filterType);
                        }

                        if (term) {
                            filtered = filtered.filter(a => 
                                a.name.toLowerCase().includes(term) || 
                                (a.description && a.description.toLowerCase().includes(term)) ||
                                (a.tags && a.tags.some(t => t.toLowerCase().includes(term)))
                            );
                        }

                        // Deduplicate items by type and name to prevent rendering duplicates
                        const seenKeys = new Set();
                        filtered = filtered.filter(item => {
                            const key = item.type + ':' + item.name;
                            if (seenKeys.has(key)) return false;
                            seenKeys.add(key);
                            return true;
                        });
                        
                        renderItems(filtered);
                    }

                    searchInput.addEventListener('input', () => {
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(applyFilters, 300);
                    });

                    typeFilter.addEventListener('change', applyFilters);

                    vscode.postMessage({ type: 'viewDidLoad' });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'updateItems':
                                allItems = [
                                    ...(message.data.agents || []), 
                                    ...(message.data.skills || [])
                                ];
                                
                                installedItemIds.clear();
                                if (message.installedData) {
                                    (message.installedData.agents || []).forEach(a => {
                                        if (a.id) installedItemIds.add(a.id);
                                        if (a.name) installedItemIds.add(a.name);
                                    });
                                    (message.installedData.skills || []).forEach(s => {
                                        if (s.id) installedItemIds.add(s.id);
                                        if (s.name) installedItemIds.add(s.name);
                                    });
                                }
                                
                                applyFilters();
                                break;
                        }
                    });

                    function escapeHtml(unsafe) {
                        return String(unsafe || '')
                             .replace(/&/g, "&amp;")
                             .replace(/</g, "&lt;")
                             .replace(/>/g, "&gt;")
                             .replace(/"/g, "&quot;")
                             .replace(/'/g, "&#039;");
                     }

                    function renderItems(items) {
                        try {
                            container.innerHTML = '';
                            if (!items || items.length === 0) {
                                container.innerHTML = '<div style="grid-column: 1/-1; text-align: center;">No items found.</div>';
                                return;
                            }

                            items.forEach(item => {
                                // Match by ID or Name
                                const isInstalled = installedItemIds.has(item.id) || installedItemIds.has(item.name);
                                const card = document.createElement('div');
                                card.className = 'card';

                                const tagsHtml = (item.tags || []).slice(0, 3).map(tag => \`<span class="tag">\${escapeHtml(tag)}</span>\`).join('');
                                
                                let cleanDesc = item.description || 'No description';
                                cleanDesc = cleanDesc.replace(/^['"]+|['"]+$/g, '');

                                const safeName = escapeHtml(item.name);
                                const safeDesc = escapeHtml(cleanDesc);
                                const safeVersion = item.version ? \`<span class="card-version">v\${escapeHtml(item.version)}</span>\` : '';
                                
                                const typeBadge = item.type === 'agent' 
                                    ? '<span class="item-type-badge type-agent">Agent</span>'
                                    : '<span class="item-type-badge type-skill">Skill</span>';

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
                                        <div class="card-title-container">
                                            \${typeBadge}
                                            <h3 class="card-title">\${safeName}</h3>
                                        </div>
                                        \${safeVersion}
                                    </div>
                                    <div class="card-desc" title="\${safeDesc}">\${safeDesc}</div>
                                    <div class="tags">\${tagsHtml}</div>
                                    <div class="actions">
                                        \${actionButtons}
                                    </div>
                                \`;

                                if (isInstalled) {
                                    card.querySelector('.uninstall-btn').addEventListener('click', () => {
                                        vscode.postMessage({ type: 'uninstallItem', item: item });
                                    });
                                } else {
                                    card.querySelector('.install-btn').addEventListener('click', () => {
                                        vscode.postMessage({ type: 'installItem', item: item });
                                    });
                                }

                                card.querySelector('.details-btn').addEventListener('click', () => {
                                    vscode.postMessage({ type: 'viewDetails', item: item, searchTerm: searchInput.value });
                                });

                                container.appendChild(card);
                            });
                        } catch (e) {
                            console.error('Error rendering items:', e);
                            container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; color: var(--vscode-errorForeground);">Error rendering: \${e.message}</div>\`;
                        }
                    }
                </script>
            </body>
            </html>`;
    }

    private getNonce() {
        let text = "";
        const possible =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
