import * as vscode from 'vscode';
import { AgentDiscovery, Agent } from './agentDiscovery';
import { AgentProvider } from './agentProvider';
import { AgentInstaller } from './agentInstaller';
import { AgentDetailsPanel } from './agentDetailsPanel';
import { AgentMarketplaceProvider } from './agentMarketplace';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-agent-manager" is now active!');

    const agentDiscovery = new AgentDiscovery();
    const agentProvider = new AgentProvider(context);
    const marketplaceProvider = new AgentMarketplaceProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AgentMarketplaceProvider.viewType, marketplaceProvider)
    );

    const treeView = vscode.window.createTreeView('agentManagerAgents', {
        treeDataProvider: agentProvider
    });

    let searchDisposable = vscode.commands.registerCommand('agentManager.search', async (force: boolean = false) => {
        // Don't clear immediately to allow cache to be shown
        // agentProvider.clear(); 
        treeView.message = 'Refreshing agents...';

        const config = vscode.workspace.getConfiguration('agentManager');
        const repositories = config.get<string[]>('repositories') || [];

        // Prune removed repositories from view
        agentProvider.prune(repositories);

        // Refresh installed agents
        await agentProvider.refreshInstalledAgents();

        if (repositories.length === 0) {
            vscode.window.showWarningMessage('No agent repositories configured.');
            treeView.message = 'No repositories configured.';
            agentProvider.clear(); // Clear all if no repos
            marketplaceProvider.updateAgents([]);
            return;
        }

        // Check if we need to fetch anything
        let reposToFetch: string[] = [];
        if (force) {
            reposToFetch = repositories;
        } else {
            reposToFetch = repositories.filter(repo => !agentProvider.isCacheValid(repo));
        }

        // If no fetch needed, just update view from cache
        if (reposToFetch.length === 0) {
            const allCached = agentProvider.getAllCachedAgents();
            marketplaceProvider.updateAgents(allCached, agentProvider.getInstalledAgents());
            treeView.message = undefined;
            return;
        }

        // We run this in "background" progress but we can update the tree immediately
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Searching for agents...",
            cancellable: false
        }, async (progress, token) => {

            let totalAgents = 0;
            // Start with what we have in cache
            let allFoundAgents: Agent[] = agentProvider.getAllCachedAgents();

            for (const repo of reposToFetch) {
                progress.report({ message: `Fetching from ${repo}...` });
                try {
                    const agents = await agentDiscovery.fetchAgentsFromRepo(repo);
                    if (agents.length > 0) {
                        agentProvider.addAgents(repo, agents);
                        // Update our local list (addAgents updates the provider's map)
                    }
                } catch (error) {
                    console.error(`Error searching ${repo}:`, error);
                    // Use cached if available?
                }
            }

            // Re-get all agents from provider as source of truth
            allFoundAgents = agentProvider.getAllCachedAgents();
            totalAgents = allFoundAgents.length;

            // Pass BOTH found agents and currently installed agents to the marketplace to update UI state
            marketplaceProvider.updateAgents(allFoundAgents, agentProvider.getInstalledAgents());

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

    let refreshSourceDisposable = vscode.commands.registerCommand('agentManager.refreshSource', async (item: any) => {
        if (item && item.repoUrl) {
            const repo = item.repoUrl;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Refreshing ${item.label}...`,
                cancellable: false
            }, async () => {
                try {
                    const agents = await agentDiscovery.fetchAgentsFromRepo(repo);
                    if (agents.length > 0) {
                        agentProvider.addAgents(repo, agents);
                        const allCached = agentProvider.getAllCachedAgents();
                        marketplaceProvider.updateAgents(allCached, agentProvider.getInstalledAgents());
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to refresh ${item.label}: ${error}`);
                }
            });
        }
    });

    // ... existing commands ...

    let installDisposable = vscode.commands.registerCommand('agentManager.install', async (item: any) => {
        // item is AgentTreeItem if called from tree view
        // If called from webview, item might be { agent: ... }
        let agent = item?.agent || item?.arguments?.[0]; // Handle different call signatures if needed
        if (!agent && item && item.agent) { agent = item.agent; } // AgentTreeItem
        if (!agent && item && item.name) { agent = item; } // Direct agent object
        // If simply passed as argument from webview messsage
        if (!agent && item.name && item.repository) { agent = item; }


        if (agent) {
            const installer = new AgentInstaller(context);
            await installer.installAgent(agent);
            // Refresh installed list after install
            await agentProvider.refreshInstalledAgents();
            marketplaceProvider.updateAgents(agentProvider.getAllCachedAgents(), agentProvider.getInstalledAgents());
        } else {
            vscode.window.showInformationMessage('Please select an agent from the list to install.');
        }
    });

    let updateDisposable = vscode.commands.registerCommand('agentManager.update', async (item: any) => {
        // item is AgentTreeItem
        if (item && item.updateAgent) {
            const installer = new AgentInstaller(context);
            // Quick update: overwrite the existing file
            // We know the installed path from item.agent.path
            await installer.installAgent(item.updateAgent, item.agent.path);

            // Refresh
            await agentProvider.refreshInstalledAgents();
        }
    });

    let uninstallDisposable = vscode.commands.registerCommand('agentManager.uninstall', async (item: any) => {
        let agent = item?.agent || item; // Handle TreeItem or direct agent object
        if (!agent) return;

        // Find the installed agent to get the path
        const installed = agentProvider.getInstalledAgents().find(a => a.name === agent.name);
        if (installed && installed.path) {
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to uninstall ${agent.name}?`,
                { modal: true },
                'Uninstall'
            );

            if (confirm === 'Uninstall') {
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(installed.path));
                    vscode.window.showInformationMessage(`Uninstalled ${agent.name}`);
                    await agentProvider.refreshInstalledAgents();
                    marketplaceProvider.updateAgents(agentProvider.getAllCachedAgents(), agentProvider.getInstalledAgents());
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to uninstall: ${error}`);
                }
            }
        } else {
            vscode.window.showErrorMessage(`Could not find installation of ${agent.name}`);
        }
    });

    let openSettingsDisposable = vscode.commands.registerCommand('agentManager.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:luizbon.vscode-agent-manager');
    });

    let openDetailsDisposable = vscode.commands.registerCommand('agentManager.openAgentDetails', (agent: any, searchTerm?: string) => {
        console.log('agentManager.openAgentDetails triggered with:', agent, searchTerm);
        if (!agent) {
            vscode.window.showErrorMessage('Failed to open agent details: No agent data provided.');
            return;
        }
        try {
            // Check if agent is TreeItem or raw object
            let agentData = agent.agent || agent;
            AgentDetailsPanel.createOrShow(context, agentData, searchTerm);
        } catch (error) {
            console.error('Error creating AgentDetailsPanel:', error);
            vscode.window.showErrorMessage(`Error opening panel: ${error}`);
        }
    });

    context.subscriptions.push(searchDisposable);
    context.subscriptions.push(installDisposable);
    context.subscriptions.push(updateDisposable);
    context.subscriptions.push(uninstallDisposable);
    context.subscriptions.push(refreshSourceDisposable);
    context.subscriptions.push(openSettingsDisposable);
    context.subscriptions.push(openDetailsDisposable);

    // Watch for configuration changes to auto-refresh
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('agentManager.repositories')) {
            vscode.commands.executeCommand('agentManager.search');
        }
    }));


    // Initial search on activation (will use cache if valid)
    vscode.commands.executeCommand('agentManager.search');
}

export function deactivate() { }
