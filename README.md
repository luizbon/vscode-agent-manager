# VS Code Agent Manager

<div align="center">
  <img src="resources/agent-manager-logo.png" alt="VS Code Agent Manager Logo" width="200" />
</div>

<div align="center">

[![Version](https://img.shields.io/visual-studio-marketplace/v/luizbon.vscode-agent-manager.png)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-agent-manager)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/luizbon.vscode-agent-manager.png)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-agent-manager)
[![Ratings](https://img.shields.io/visual-studio-marketplace/r/luizbon.vscode-agent-manager.png)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-agent-manager)

</div>

**VS Code Agent Manager** is the essential toolkit for supercharging your GitHub Copilot experience. Effortlessly discover, install, and manage custom Copilot Agents, Skills, and Plugins directly within VS Code.

> **Note:** This extension is designed to work with GitHub Copilot Chat.

---

## 🚀 Features

### 🔍 Auto-Discovery from any Git Repo
Stop manually hunting for configurations. Point the Agent Manager to **any GitHub repository** (like the popular `awesome-copilot` lists or your own team's private repo), and it will automatically index all available items. It recursively scans the repository looking for `.agent.md`, `.skill.md`, or `SKILL.md` files, parsing their YAML frontmatter or HTML comments to extract descriptions, authors, and tags.

### 🧠 Skills Management
In addition to agents, the extension supports the discovery and management of **Skills**. A skill is a reusable set of instructions or context that can be attached to agents. The extension automatically discovers skills in your configured repositories and allows you to install and manage them alongside your agents.

### 🔌 Plugin Support
Discover and manage plugins for the Copilot. Provide repository sources, and the Agent Manager will index compatible plugins. View detailed plugin documentation directly in the marketplace.

### 📦 One-Click Installation
Install agents in seconds. Choose to install them globally (User Profile) for access in all projects, or locally (Workspace) for project-specific needs.

### 🔄 Smart Updates & Version Control
Stay up to date. The extension tracks installed versions against the remote source, alerting you when updates are available. View changelogs and author details at a glance.

### 🛡️ Git-Powered Reliability & Robustness
Built on top of Git, ensuring that you always get the exact version of the agent you expect. The extension features highly robust Git integration with built-in safeguards (like semaphores) to prevent concurrent operations and ensure stable performance even when working with large repositories.

### 📊 Telemetry & Insights
Includes privacy-respecting telemetry (opt-in based on your overall VS Code settings) using PostHog and Application Insights. This helps us continuously improve the extension by understanding how features are used and quickly identifying any issues in the wild.

---

## 📖 Usage

### 1. Discover Agents
Open the **Agent Manager** view by clicking the robot icon in the Activity Bar. The list will automatically populate with agents from the default repository.

### 2. View Details
Click on any agent, skill, or plugin to see its description, author, tags, and version history in a dedicated details panel.
The panel includes a **Markdown Preview** allowing you to read full READMEs seamlessly with syntax highlighting, alongside a tab for raw content.

### 3. Install
Click the **Install** button in the details panel or the download icon in the list.
- **Workspace Install**: Saves to `.github/agents` in your current folder.
- **User Install**: Saves to your global VS Code prompts directory.

### 4. Manage
The view separates Installed agents from Discovered ones. Right-click an installed agent to **Update** or **Uninstall** it.

---

## ⚙️ Configuration

Customize your agent sources via VS Code Settings:

| Setting | Description | Default |
| :--- | :--- | :--- |
| `agentManager.repositories` | List of GitHub repo URLs to scan for agents. | `["https://github.com/github/awesome-copilot"]` |
| `agentManager.pluginSources` | List of GitHub repos to index for Copilot plugins. | `["https://github.com/anthropics/claude-code"]` |

---

## 🤝 Contributing

We love contributions!
1. Fork the repo.
2. Create a feature branch.
3. Submit a Pull Request.

---

**Enjoy building with Agents!**
