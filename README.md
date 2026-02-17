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

## Contributing

Contributions are welcome! If you'd like to help improve the VS Code Agent Manager, please follow these steps:

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally: `git clone https://github.com/your-username/vscode-agent-manager.git`
3.  **Create a feature branch**: `git checkout -b feature/my-new-feature`
4.  **Make your changes** and ensure they follow the project's coding standards.
5.  **Run tests**: Ensure all tests pass with `npm test`.
6.  **Commit your changes**: `git commit -m "Add some feature"`
7.  **Push to the branch**: `git push origin feature/my-new-feature`
8.  **Open a Pull Request** against the main repository.

---

**Enjoy building with Agents!**
