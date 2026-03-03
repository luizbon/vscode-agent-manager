import "source-map-support/register";
import * as vscode from "vscode";
import * as os from "os";
import * as querystring from "querystring";
import * as path from 'path';
import * as fs from 'fs';

// Domain
import { IMarketplaceItem } from './domain/models/marketplaceItem';

// Application
import { MarketplaceService } from './application/marketplaceService';
import { InstallerService, IStateStore, IConflictResolver } from './application/installerService';

// Infrastructure
import { GitSource } from './infrastructure/sources/gitSource';
import { LocalWorkspaceStorage } from './infrastructure/storage/localWorkspaceStorage';
import { GlobalStorage } from './infrastructure/storage/globalStorage';

// Presentation (UI)
import { MarketplaceTreeProvider } from './ui/providers/marketplaceTreeProvider';
import { MarketplaceWebviewProvider } from './ui/views/marketplaceWebview';
import { DetailsPanel } from './ui/panels/detailsPanel';

// Services
import { TelemetryService } from "./services/telemetry";

function extractItem(item: any): IMarketplaceItem | undefined {
  if (!item) {
    return undefined;
  }
  if (item.item && item.item.name) {
    return item.item as IMarketplaceItem;
  }
  if (item.name && item.repository) {
    return item as IMarketplaceItem;
  }
  if (item.arguments && item.arguments[0] && item.arguments[0].name) {
    return item.arguments[0] as IMarketplaceItem;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "vscode-agent-manager" is now active!');

  const telemetry = TelemetryService.getInstance();
  context.subscriptions.push(telemetry);

  const hasAskedTelemetry = context.globalState.get<boolean>("agentManager.hasAskedTelemetry");
  if (!hasAskedTelemetry) {
    const enableTelemetry = "Enable Telemetry";
    const disableTelemetry = "Disable Telemetry";
    vscode.window
      .showInformationMessage(
        "Help improve Agent Manager by sending anonymous usage data?",
        enableTelemetry,
        disableTelemetry,
      )
      .then((selection) => {
        if (selection === enableTelemetry) {
          vscode.workspace.getConfiguration("agentManager").update("enableTelemetry", true, vscode.ConfigurationTarget.Global);
        } else if (selection === disableTelemetry) {
          vscode.workspace.getConfiguration("agentManager").update("enableTelemetry", false, vscode.ConfigurationTarget.Global);
        }
        context.globalState.update("agentManager.hasAskedTelemetry", true);
      });
  }

  telemetry.sendEvent("activate");

  const globalStoragePath = context.globalStorageUri.fsPath;

  // Dependency Injection setup
  const gitSource = new GitSource();
  const globalStorage = new GlobalStorage(globalStoragePath);

  const marketplaceService = new MarketplaceService(globalStoragePath);

  const stateStore: IStateStore = {
    get: async (key: string, isGlobal: boolean) => {
      return isGlobal ? context.globalState.get<string>(key) : context.workspaceState.get<string>(key);
    },
    update: async (key: string, value: string, isGlobal: boolean) => {
      if (isGlobal) { await context.globalState.update(key, value); }
      else { await context.workspaceState.update(key, value); }
    }
  };

  const conflictResolver: IConflictResolver = {
    resolve: async (item: IMarketplaceItem, targetPath: string) => {
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc);

      const choice = await vscode.window.showWarningMessage(
        `Conflicts found while updating ${item.name}. Please review the conflict markers in the file.`,
        { modal: true },
        'Override', 'Keep Merged / Fix Manually', 'Cancel'
      );

      if (choice === 'Cancel') { return 'cancel'; }
      if (choice === 'Override') { return 'override'; }
      return 'manual';
    }
  };

  const userDir = path.dirname(path.dirname(globalStoragePath));
  const userPath = path.join(userDir, 'prompts');
  const globalSkillPath = path.join(os.homedir(), '.copilot', 'skills');

  const isUserPath = (p: string) => p.startsWith(userPath) || p.startsWith(globalSkillPath);
  const installerService = new InstallerService(stateStore, conflictResolver, isUserPath);

  const treeProvider = new MarketplaceTreeProvider(context);
  const webviewProvider = new MarketplaceWebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MarketplaceWebviewProvider.viewType, webviewProvider)
  );

  const treeView = vscode.window.createTreeView("agentManagerAgents", { treeDataProvider: treeProvider });

  const refreshInstalledItems = async () => {
    const local = await LocalWorkspaceStorage.getInstalledItems();
    const global = globalStorage.getInstalledItems();

    const combinedAgents = [...local.agents, ...global.agents];
    const combinedSkills = [...local.skills, ...global.skills];

    treeProvider.setInstalledItems(combinedAgents, combinedSkills);
  };

  let searchDisposable = vscode.commands.registerCommand(
    "marketplace.search",
    async (force: boolean = false) => {
      treeView.message = "Refreshing items...";
      telemetry.sendEvent("search.start", { force: force.toString() });

      const config = vscode.workspace.getConfiguration("agentManager");
      const repositories = config.get<string[]>("repositories") || [];

      treeProvider.prune(repositories);
      await refreshInstalledItems();

      if (repositories.length === 0) {
        vscode.window.showWarningMessage("No repositories configured.");
        treeView.message = "No repositories configured.";
        treeProvider.clear();
        webviewProvider.updateItems({ agents: [], skills: [] });
        return;
      }

      let reposToFetch = force ? repositories : repositories.filter(repo => !treeProvider.isCacheValid(repo));

      if (reposToFetch.length === 0) {
        const allCached = treeProvider.getAllCachedItems();
        webviewProvider.updateItems(allCached, treeProvider.getInstalledItems());
        treeView.message = undefined;
        return;
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Searching for items...", cancellable: false },
        async (progress) => {
          let totalItems = 0;
          for (const repo of reposToFetch) {
            progress.report({ message: `Fetching from ${repo}...` });
            try {
              const fetched = await marketplaceService.fetchItemsFromRepo(repo, gitSource);
              if (fetched.agents.length > 0 || fetched.skills.length > 0) {
                treeProvider.addItems(repo, fetched.agents, fetched.skills);
              }
            } catch (error) {
              console.error(`Error searching ${repo}:`, error);
              telemetry.sendError(error as Error, { context: "search", repo });
            }
          }

          const allCached = treeProvider.getAllCachedItems();
          totalItems = allCached.agents.length + allCached.skills.length;

          webviewProvider.updateItems(allCached, treeProvider.getInstalledItems());

          if (totalItems === 0 && repositories.length > 0 && treeProvider.isEmpty) {
            treeView.message = "No items found.";
          } else {
            treeView.message = undefined;
          }

          telemetry.sendEvent("search.complete", { itemCount: totalItems.toString() });
        }
      );
    }
  );

  let refreshSourceDisposable = vscode.commands.registerCommand(
    "marketplace.refreshSource",
    async (uiItem: any) => {
      if (uiItem && uiItem.repoUrl) {
        const repo = uiItem.repoUrl;
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Refreshing ${uiItem.label}...`, cancellable: false },
          async () => {
            try {
              const fetched = await marketplaceService.fetchItemsFromRepo(repo, gitSource);
              treeProvider.addItems(repo, fetched.agents, fetched.skills);
              webviewProvider.updateItems(treeProvider.getAllCachedItems(), treeProvider.getInstalledItems());
              telemetry.sendEvent("refreshSource.success", { repo });
            } catch (error) {
              telemetry.sendError(error as Error, { context: "refreshSource", repo });
              vscode.window.showErrorMessage(`Failed to refresh ${uiItem.label}: ${error}`);
            }
          }
        );
      }
    }
  );

  let installDisposable = vscode.commands.registerCommand(
    "marketplace.install",
    async (uiItem: any) => {
      const item = extractItem(uiItem);
      if (item) {
        try {
          telemetry.sendEvent("install.start", { item: item.name });

          const installOptions: vscode.QuickPickItem[] = [];
          if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('chat');
            const settingName = item.type === 'agent' ? 'agentFilesLocations' : 'agentSkillsLocations';
            const configLocations = config.get<string[]>(settingName);

            let locations: string[] = [];
            if (Array.isArray(configLocations)) { locations = [...configLocations]; }

            if (locations.length > 0) {
              for (const loc of locations) {
                installOptions.push({
                  label: `Install to Workspace (${loc})`,
                  description: path.isAbsolute(loc) ? loc : path.join(workspaceRoot, loc)
                });
              }
            } else {
              const defaultLoc = item.type === 'agent' ? '.github/agents' : '.github/skills';
              installOptions.push({
                label: `Install to Workspace (${defaultLoc})`,
                description: path.join(workspaceRoot, defaultLoc)
              });
            }
          }

          if (item.type === 'agent') {
            installOptions.push({
              label: 'Install to User Profile (prompts)',
              description: userPath
            });
          } else {
            installOptions.push({
              label: 'Install to Global Skills (~/.copilot/skills)',
              description: globalSkillPath
            });
          }

          const selection = await vscode.window.showQuickPick(installOptions, { placeHolder: `Where do you want to install ${item.name}?` });

          if (selection && selection.description) {
            const installBasePath = selection.description;
            await installerService.installItem(item, installBasePath);
            vscode.window.showInformationMessage(`${item.type === 'agent' ? 'Agent' : 'Skill'} ${item.name} installed successfully.`);

            // Always refresh the UI first, regardless of whether we can open the file
            await refreshInstalledItems();
            webviewProvider.updateItems(treeProvider.getAllCachedItems(), treeProvider.getInstalledItems());
            telemetry.sendEvent("install.success", { item: item.name });

            // Try to open the installed file in the editor
            try {
              const fileName = path.basename(item.path);
              let finalFileDir = installBasePath;
              if (item.baseDirectory) {
                finalFileDir = path.join(installBasePath, item.baseDirectory);
              }
              const finalFilePath = path.join(finalFileDir, fileName);
              const doc = await vscode.workspace.openTextDocument(finalFilePath);
              await vscode.window.showTextDocument(doc);
            } catch (openErr) {
              // Non-fatal: the file was installed, we just couldn't open it
              console.warn(`Could not open installed file in editor: ${openErr}`);
            }
          }
        } catch (error) {
          telemetry.sendError(error as Error, { context: "install", item: item?.name || 'unknown' });
          vscode.window.showErrorMessage(`Failed to install item: ${error}`);
        }
      } else {
        vscode.window.showInformationMessage("Please select an item from the list to install.");
      }
    }
  );

  let updateDisposable = vscode.commands.registerCommand(
    "marketplace.update",
    async (uiItem: any) => {
      const item = extractItem(uiItem);
      if (item && uiItem.updateItem) {
        try {
          telemetry.sendEvent("update.start", { item: item.name });
          const status = await installerService.updateItem(uiItem.updateItem as IMarketplaceItem, item.path);

          if (status === 'updated') {
            vscode.window.showInformationMessage(`${item.type === 'agent' ? 'Agent' : 'Skill'} ${item.name} updated successfully.`);
            const doc = await vscode.workspace.openTextDocument(item.path);
            await vscode.window.showTextDocument(doc);
          } else if (status === 'cancelled') {
            vscode.window.showInformationMessage('Update cancelled.');
          }

          await refreshInstalledItems();
          telemetry.sendEvent("update.success", { item: item.name });
        } catch (error) {
          telemetry.sendError(error as Error, { context: "update", item: item.name });
          vscode.window.showErrorMessage(`Failed to update item: ${error}`);
        }
      }
    }
  );

  let uninstallDisposable = vscode.commands.registerCommand(
    "marketplace.uninstall",
    async (uiItem: any) => {
      const item = extractItem(uiItem);
      if (!item) { return; }

      const installedList = item.type === 'agent' ? treeProvider.getInstalledItems().agents : treeProvider.getInstalledItems().skills;
      const installed = installedList.find(a => a.name === item.name);

      if (installed && installed.path) {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to uninstall ${item.name}?`,
          { modal: true }, "Uninstall"
        );

        if (confirm === "Uninstall") {
          try {
            telemetry.sendEvent("uninstall.start", { item: item.name });

            if (item.type === 'skill') {
              const parentDir = path.dirname(installed.path);
              // Treat skill directories as packages - delete the whole folder,
              // UNLESS the skill is installed directly in a root skills dir (no subdirectory)
              const skillRootDirs = [
                path.join(os.homedir(), '.copilot', 'skills'),
              ];
              if (vscode.workspace.workspaceFolders) {
                const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const config = vscode.workspace.getConfiguration('chat');
                const skillSetting = config.get<string[]>('agentSkillsLocations') || [];
                const skillPaths = skillSetting.length > 0 ? skillSetting : ['.github/skills'];
                for (const loc of skillPaths) {
                  skillRootDirs.push(path.isAbsolute(loc) ? loc : path.join(workspaceRoot, loc));
                }
              }

              const isRootDir = skillRootDirs.some(r => path.resolve(parentDir) === path.resolve(r));
              if (isRootDir) {
                // Flat install - just delete the file
                await vscode.workspace.fs.delete(vscode.Uri.file(installed.path));
              } else {
                // Packaged install - delete the whole skill directory
                await vscode.workspace.fs.delete(vscode.Uri.file(parentDir), { recursive: true });
              }
            } else {
              await vscode.workspace.fs.delete(vscode.Uri.file(installed.path));
            }

            vscode.window.showInformationMessage(`Uninstalled ${item.name}`);

            await refreshInstalledItems();
            webviewProvider.updateItems(treeProvider.getAllCachedItems(), treeProvider.getInstalledItems());
            telemetry.sendEvent("uninstall.success", { item: item.name });
          } catch (error) {
            telemetry.sendError(error as Error, { context: "uninstall", item: item.name });
            vscode.window.showErrorMessage(`Failed to uninstall: ${error}`);
          }
        }
      } else {
        vscode.window.showErrorMessage(`Could not find installation of ${item.name}`);
      }
    }
  );

  let openSettingsDisposable = vscode.commands.registerCommand(
    "agentManager.openSettings",
    () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:luizbon.vscode-agent-manager");
    }
  );

  let openDetailsDisposable = vscode.commands.registerCommand(
    "marketplace.openDetails",
    (item: any, searchTerm?: string) => {
      if (!item) {
        vscode.window.showErrorMessage("Failed to open details: No item data provided.");
        return;
      }
      try {
        let itemData = item.item || item;
        telemetry.sendEvent("openDetails", { item: itemData.name, hasSearchTerm: (!!searchTerm).toString() });
        DetailsPanel.createOrShow(context, itemData, searchTerm);
      } catch (error) {
        console.error("Error creating DetailsPanel:", error);
        telemetry.sendError(error as Error, { context: "openDetails" });
        vscode.window.showErrorMessage(`Error opening panel: ${error}`);
      }
    }
  );

  let feedbackDisposable = vscode.commands.registerCommand(
    "agentManager.feedback",
    async () => {
      const feedbackTypes = ["Report a Bug", "Feature Request"];
      const selectedKey = await vscode.window.showQuickPick(feedbackTypes, { placeHolder: "What kind of feedback do you have?" });

      if (!selectedKey) { return; }

      const isBug = selectedKey === "Report a Bug";
      const extensionVersion = vscode.extensions.getExtension("luizbon.vscode-agent-manager")?.packageJSON.version || "unknown";
      const systemInfo = `**Environment:**\n- OS: ${os.platform()} ${os.release()} (${os.arch()})\n- VS Code: ${vscode.version}\n- Extension Version: ${extensionVersion}\n- Remote: ${vscode.env.remoteName || "local"}`;

      const title = isBug ? "Bug Report: <short description>" : "Feature Request: <short description>";
      const body = isBug
        ? `**Description**\n\n**Steps to Reproduce**\n1.\n2.\n\n**Expected Behavior**\n\n**Actual Behavior**\n\n${systemInfo}`
        : `**Feature Description**\n\n**Use Case**\n\n${systemInfo}`;

      const query = querystring.stringify({ title, body });
      const url = `https://github.com/luizbon/vscode-agent-manager/issues/new?${query}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  );

  const feedbackStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  feedbackStatusBarItem.text = "$(comment-discussion) Feedback";
  feedbackStatusBarItem.tooltip = "Send Feedback for Agent Manager";
  feedbackStatusBarItem.command = "agentManager.feedback";
  feedbackStatusBarItem.show();
  context.subscriptions.push(feedbackStatusBarItem);

  context.subscriptions.push(searchDisposable);
  context.subscriptions.push(installDisposable);
  context.subscriptions.push(updateDisposable);
  context.subscriptions.push(uninstallDisposable);
  context.subscriptions.push(refreshSourceDisposable);
  context.subscriptions.push(openSettingsDisposable);
  context.subscriptions.push(openDetailsDisposable);
  context.subscriptions.push(feedbackDisposable);

  // Aliases for backward compatibility in package.json until fully replaced
  context.subscriptions.push(vscode.commands.registerCommand("agentManager.search", () => vscode.commands.executeCommand("marketplace.search")));
  context.subscriptions.push(vscode.commands.registerCommand("agentManager.install", (i) => vscode.commands.executeCommand("marketplace.install", i)));
  context.subscriptions.push(vscode.commands.registerCommand("agentManager.update", (i) => vscode.commands.executeCommand("marketplace.update", i)));
  context.subscriptions.push(vscode.commands.registerCommand("agentManager.uninstall", (i) => vscode.commands.executeCommand("marketplace.uninstall", i)));
  context.subscriptions.push(vscode.commands.registerCommand("agentManager.refreshSource", (i) => vscode.commands.executeCommand("marketplace.refreshSource", i)));
  context.subscriptions.push(vscode.commands.registerCommand("agentManager.openAgentDetails", (i) => vscode.commands.executeCommand("marketplace.openDetails", i)));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("agentManager.repositories")) {
        vscode.commands.executeCommand("marketplace.search");
      }
    })
  );

  vscode.commands.executeCommand("marketplace.search");
}

export function deactivate() { }
