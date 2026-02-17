# VS Code Agent Manager

<div align="center">
  <img src="resources/agent-manager-logo.png" alt="VS Code Agent Manager Logo" width="200" />
</div>

<div align="center">

[![Version](https://img.shields.io/visual-studio-marketplace/v/luizbon.vscode-agent-manager.png)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-agent-manager)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/luizbon.vscode-agent-manager.png)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-agent-manager)
[![Ratings](https://img.shields.io/visual-studio-marketplace/r/luizbon.vscode-agent-manager.png)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-agent-manager)

</div>

**VS Code Agent Manager** is the essential toolkit for supercharging your GitHub Copilot experience. Effortlessly discover, install, and manage custom Copilot Agents directly within VS Code.

> **Note:** This extension is designed to work with GitHub Copilot Chat.

---

## 🚀 Features

### 🔍 Auto-Discovery
Stop manually hunting for agent configurations. Point the Agent Manager to any GitHub repository (like the popular `awesome-copilot` lists), and it will automatically index all available agents.

### 📦 One-Click Installation
Install agents in seconds. Choose to install them globally (User Profile) for access in all projects, or locally (Workspace) for project-specific needs.

### 🔄 Smart Updates & Version Control
Stay up to date. The extension tracks installed versions against the remote source, alerting you when updates are available. View changelogs and author details at a glance.

### 🛡️ Git-Powered Reliability
Built on top of Git, ensuring that you always get the exact version of the agent you expect, with verified author and commit data.

---

## 📖 Usage

### 1. Discover Agents
Open the **Agent Manager** view by clicking the robot icon in the Activity Bar. The list will automatically populate with agents from the default repository.

### 2. View Details
Click on any agent to see its description, author, tags, and version history in a dedicated details panel.

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

---

## 🤝 Contributing

We love contributions!
1. Fork the repo.
2. Create a feature branch.
3. Submit a Pull Request.

---

**Enjoy building with Agents!**
