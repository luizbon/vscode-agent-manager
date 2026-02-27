const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

try {
  let fileCheck = execSync('npm run compile').toString();
} catch (e) {
  console.log("Compile error:");
}

const { MarketplaceTreeProvider } = require('./out/ui/providers/marketplaceTreeProvider');
const { LocalWorkspaceStorage } = require('./out/infrastructure/storage/localWorkspaceStorage');
const { GlobalStorage } = require('./out/infrastructure/storage/globalStorage');
const { MarketplaceService } = require('./out/application/marketplaceService');

async function check() {
  const local = await LocalWorkspaceStorage.getInstalledItems();
  const globalStoragePath = '/Users/luizb/Library/Application Support/Code/User/globalStorage/luizbon.vscode-agent-manager';
  const global = new GlobalStorage(globalStoragePath).getInstalledItems();

  console.log('--- LOCAL ITEMS ---', local.agents.length, local.skills.length);
  if (local.agents.length) console.log('Local Agent 0:', local.agents[0].name, '|', local.agents[0].id);
  
  console.log('--- GLOBAL ITEMS ---', global.agents.length, global.skills.length);
  if (global.agents.length) console.log('Global Agent 0:', global.agents[0].name, '|', global.agents[0].id);
  if (global.skills.length) console.log('Global Skill 0:', global.skills[0].name, '|', global.skills[0].id);
}

check();
