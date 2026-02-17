import * as vscode from 'vscode';
import { AgentDiscovery } from './agentDiscovery';
import { AgentProvider } from './agentProvider';
import { AgentInstaller } from './agentInstaller';
import { AgentDetailsPanel } from './agentDetailsPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-agent-manager" is now active!');

    const agentDiscovery = new AgentDiscovery();
    const agentProvider = new AgentProvider(context);

    const treeView = vscode.window.createTreeView('agentManagerAgents', {
        treeDataProvider: agentProvider
    });

    let searchDisposable = vscode.commands.registerCommand('agentManager.search', async () => {
        // Don't clear immediately to allow cache to be shown
        // agentProvider.clear(); 
        treeView.message = 'Refreshing agents...';

        const config = vscode.workspace.getConfiguration('agentManager');
        const repositories = config.get<string[]>('repositories') || [];

        // Prune removed repositories from view
        agentProvider.prune(repositories);

        if (repositories.length === 0) {
            vscode.window.showWarningMessage('No agent repositories configured.');
            treeView.message = 'No repositories configured.';
            agentProvider.clear(); // Clear all if no repos
            return;
        }

        // We run this in "background" progress but we can update the tree immediately
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Searching for agents...",
            cancellable: false
        }, async (progress, token) => {

            let totalAgents = 0;

            for (const repo of repositories) {
                progress.report({ message: `Fetching from ${repo}...` });
                try {
                    const agents = await agentDiscovery.fetchAgentsFromRepo(repo);
                    if (agents.length > 0) {
                        agentProvider.addAgents(repo, agents);
                        totalAgents += agents.length;
                    }
                } catch (error) {
                    console.error(`Error searching ${repo}:`, error);
                }
            }

            if (totalAgents === 0) {
                if (repositories.length > 0 && agentProvider.isEmpty) {
                    treeView.message = 'No agents found.';
                } else {
                    treeView.message = undefined;
                }
            } else {
                treeView.message = undefined;
            }

            // vscode.window.showInformationMessage(`Found ${totalAgents} agents.`);
        });
    });

    let installDisposable = vscode.commands.registerCommand('agentManager.install', async (item: any) => {
        // item is AgentTreeItem if called from tree view
        // If called from webview, item might be { agent: ... }
        let agent = item?.agent || item?.arguments?.[0]; // Handle different call signatures if needed
        if (!agent && item && item.agent) { agent = item.agent; } // AgentTreeItem
        if (!agent && item && item.name) { agent = item; } // Direct agent object

        if (agent) {
            const installer = new AgentInstaller(context);
            await installer.installAgent(agent);
        } else {
            vscode.window.showInformationMessage('Please select an agent from the list to install.');
        }
    });

    let openSettingsDisposable = vscode.commands.registerCommand('agentManager.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'agentManager.repositories');
    });

    let openDetailsDisposable = vscode.commands.registerCommand('agentManager.openAgentDetails', (agent: any) => {
        console.log('agentManager.openAgentDetails triggered with:', agent);
        if (!agent) {
            vscode.window.showErrorMessage('Failed to open agent details: No agent data provided.');
            return;
        }
        try {
            AgentDetailsPanel.createOrShow(context, agent);
        } catch (error) {
            console.error('Error creating AgentDetailsPanel:', error);
            vscode.window.showErrorMessage(`Error opening panel: ${error}`);
        }
    });

    context.subscriptions.push(searchDisposable);
    context.subscriptions.push(installDisposable);
    context.subscriptions.push(openSettingsDisposable);
    context.subscriptions.push(openDetailsDisposable);

    // Watch for configuration changes to auto-refresh
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('agentManager.repositories')) {
            vscode.commands.executeCommand('agentManager.search');
        }
    }));


    // Initial search on activation
    vscode.commands.executeCommand('agentManager.search');
}

export function deactivate() { }
