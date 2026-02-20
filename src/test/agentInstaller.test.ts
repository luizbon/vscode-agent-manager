import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as fs from "fs";
import { AgentInstaller } from "../agent/agentInstaller";
import { Agent } from "../agent/agentDiscovery";
import { GitService } from "../services/gitService";

suite("AgentInstaller Test Suite", () => {
  let sandbox: sinon.SinonSandbox;
  let installer: AgentInstaller;
  let mockContext: vscode.ExtensionContext;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockContext = {
      globalState: {
        get: sandbox.stub(),
        update: sandbox.stub(),
        keys: () => [],
      } as any,
      workspaceState: {
        get: sandbox.stub(),
        update: sandbox.stub(),
      } as any,
      secrets: {
        get: sandbox.stub(),
        store: sandbox.stub(),
        delete: sandbox.stub(),
        onDidChange: new vscode.EventEmitter().event,
      } as any,
      extensionUri: vscode.Uri.file("/tmp"),
      globalStorageUri: vscode.Uri.file("/tmp/globalStorage"),
      logUri: vscode.Uri.file("/tmp/log"),
      extensionMode: vscode.ExtensionMode.Test,
      asAbsolutePath: (relativePath: string) => `/tmp/${relativePath}`,
      storageUri: vscode.Uri.file("/tmp/storage"),
      subscriptions: [],
      environmentVariableCollection: {} as any,
      extension: {
        id: "test.extension",
        extensionUri: vscode.Uri.file("/tmp"),
        packageJSON: {},
        extensionKind: vscode.ExtensionKind.UI,
        isActive: true,
        exports: undefined,
        activate: () => Promise.resolve(),
      } as any,
      storagePath: "/tmp/storage",
      globalStoragePath: "/tmp/globalStorage",
      logPath: "/tmp/log",
    } as unknown as vscode.ExtensionContext;

    installer = new AgentInstaller(mockContext);

    sandbox.stub(GitService.prototype, "getRepoRoot").resolves("/tmp/repo");
    sandbox.stub(GitService.prototype, "getHeadSha").resolves("abcd123");
    sandbox
      .stub(GitService.prototype, "getFileContentAtSha")
      .resolves("base content");
    sandbox.stub(GitService.prototype, "mergeUpdate").resolves(true);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Installs agent correctly", async () => {
    const agent: Agent = {
      name: "Test Agent",
      description: "Test Description",
      version: "1.0.0",
      installUrl: "https://example.com/agent.md",
      path: "agent.md",
      repository: "https://github.com/owner/repo",
    };

    const showQuickPickStub = sandbox
      .stub(vscode.window, "showQuickPick")
      .resolves({
        label: "Install to Workspace",
        description: "/tmp/workspace/.github/agents",
      } as any);

    const fsExistsSyncStub = sandbox.stub(fs, "existsSync").returns(true); // Don't create dir
    const fsMkdirStub = sandbox.stub(fs.promises, "mkdir").resolves();
    const fsCopyFileStub = sandbox.stub(fs.promises, "copyFile").resolves();

    // Stub workspace open/show
    const openDocStub = sandbox
      .stub(vscode.workspace, "openTextDocument")
      .resolves({} as any);
    const showDocStub = sandbox
      .stub(vscode.window, "showTextDocument")
      .resolves({} as any);
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

    await installer.installAgent(agent);

    assert.ok(showQuickPickStub.calledOnce);
    assert.ok(
      fsCopyFileStub.calledWith(agent.installUrl, sinon.match(/agent\.md$/)),
    );
    // Check state was updated instead of .base file
    assert.ok(
      (mockContext.workspaceState.update as sinon.SinonStub).calledWith(
        "agentSha:/tmp/workspace/.github/agents/agent.md",
        "abcd123",
      ),
      "workspaceState should be updated with git SHA",
    );
    assert.ok(
      showInfoStub.calledWithMatch(sinon.match(/installed successfully/)),
    );
  });
});
