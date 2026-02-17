# VS Code Agent Manager

The **VS Code Agent Manager** is a powerful extension that simplifies the discovery, installation, and management of GitHub Copilot Agents within Visual Studio Code.

## Features

-   **Agent Discovery**: Automatically fetch and list available agents from configured GitHub repositories (e.g., awesome-copilot lists).
-   **One-Click Installation**: Install agents directly into your workspace or user profile with a single click.
-   **Agent Details**: View comprehensive agent information including descriptions, versions, authors, and last update dates.
-   **Git Integration**: Automatically fetches the latest commit date information from the agent's source repository.
-   **Update Management**: Easily check for updates and keep your agents current.
-   **Version Control**: Compare local installed versions against remote versions to see what has changed.

## Usage

1.  **Open the Agent Manager View**:
    -   Click on the **Agent Manager** icon in the Activity Bar (the robot head icon).
    -   Or run the command `Agent Manager: Refresh Agents`.

2.  **Browse Agents**:
    -   The view lists all discovered agents from the configured repositories.
    -   Click on an agent to view its details.

3.  **Install an Agent**:
    -   In the Details panel, click **Install Agent**.
    -   Choose the installation location:
        -   **Workspace**: Installs to `.github/agents` in your current workspace.
        -   **User Profile**: Installs to your global VS Code user prompts directory (available across all workspaces).

4.  **Update an Agent**:
    -   If an update is available, the Details panel will show an **Update Agent** button.
    -   Click it to fetch the latest version.

## Configuration

You can configure the repositories used for agent discovery in your VS Code settings:

-   `agentManager.repositories`: A list of GitHub repository URLs to scan for agents.
    -   Default: `https://github.com/github/awesome-copilot`

## Requirements

-   VS Code v1.96.0 or higher.
-   GitHub Copilot Chat extension (recommended for using the installed agents).

## Extension Settings

This extension contributes the following settings:

*   `agentManager.repositories`: List of GitHub repositories to search for agents.

## Known Issues

-   Ensure you have internet access to fetch agent lists from GitHub.
-   GitHub API rate limits may apply if excessive requests are made without authentication (though the extension uses public endpoints).

## Release Notes

### 0.0.1

-   Initial release of VS Code Agent Manager.
-   Support for discovering, installing, and updating agents.
-   Git-based metadata fetching for accurate author and date information.

## Development

1.  Clone the repository.
2.  Run `npm install` to install dependencies.
3.  Press `F5` to open a new VS Code window with the extension loaded.
4.  Run tests with `npm test`.

## Publishing

This repository includes a GitHub Action workflow to automatically publish new versions to the Visual Studio Marketplace.

1.  **Generate a Personal Access Token (PAT)**:
    -   Log in to [Azure DevOps](https://dev.azure.com/) with the Microsoft account associated with your VS Code Marketplace publisher.
    -   Create a new PAT with `Marketplace (manage)` scope.
2.  **Add Secret to Repository**:
    -   Go to your GitHub repository settings -> Secrets and variables -> Actions.
    -   Add a new repository secret named `VSCE_PAT` with your token value.
3.  **Create a New Release**:
    -   Update the version in `package.json` (e.g., `npm version patch`).
    -   Push the changes and the new tag (e.g., `git push && git push --tags`).
    -   The `Release` workflow will automatically run and publish the extension.

---

**Enjoy building with Agents!**
