import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Commands should be registered", async () => {
    const ext = vscode.extensions.getExtension("luizbon.vscode-agent-manager");
    assert.ok(ext, "Extension not found");
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("agentManager.search"),
      "agentManager.search not found",
    );
    assert.ok(
      commands.includes("agentManager.install"),
      "agentManager.install not found",
    );
    assert.ok(
      commands.includes("agentManager.openSettings"),
      "agentManager.openSettings not found",
    );
    assert.ok(
      commands.includes("agentManager.uninstall"),
      "agentManager.uninstall not found",
    );
  });
});
