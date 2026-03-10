import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

export interface ICliPlugin {
    name: string;
    description?: string;
    version?: string;
    author?: string;
    isInstalled: boolean;
}

export class CopilotCliService {

    /**
     * Checks if the GitHub Copilot CLI is installed.
     * @returns True if installed, false otherwise.
     */
    public async isCliInstalled(): Promise<boolean> {
        try {
            await execPromise('copilot --version');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Lists the installed Copilot CLI plugins.
     * @returns A list of installed plugins.
     */
    public async listInstalledPlugins(): Promise<ICliPlugin[]> {
        if (!(await this.isCliInstalled())) {
            return [];
        }

        try {
            const { stdout } = await execPromise('copilot plugin list --json');
            // Assuming the output can be parsed as JSON based on the `--json` flag. 
            // If the CLI doesn't natively support `--json` for list, we will need to parse the stdout lines.
            // Let's fallback to parsing the standard output securely for now.
            try {
                const parsed = JSON.parse(stdout);
                // Attempt to map from JSON output if available
                if (Array.isArray(parsed)) {
                    return parsed.map(p => ({
                        name: p.name || p.plugin,
                        description: p.description || '',
                        version: p.version || '',
                        author: p.author || '',
                        isInstalled: true
                    }));
                }
            } catch (jsonError) {
                // Fallback: Parse line-by-line Standard Output if JSON fails
                return this.parseListOutput(stdout);
            }
        } catch (error) {
            console.error('Failed to list plugins using Copilot CLI:', error);
        }
        return [];
    }

    /**
     * Helper to parse the standard text output of 'copilot plugin list'.
     */
    private parseListOutput(output: string): ICliPlugin[] {
        const lines = output.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const plugins: ICliPlugin[] = [];
        // Typically output might look like:
        // PLUGIN_NAME   VERSION
        // some-plugin     1.0.0

        let parsingData = false;

        for (const line of lines) {
            // Very naive parser, ignoring headers.
            if (line.toLowerCase().includes('plugin') && line.toLowerCase().includes('version')) {
                parsingData = true;
                continue;
            }
            if (!parsingData && line.length > 0 && !line.includes(' ')) {
                // Heuristic: If there are no spaces, it might just be the plugin name
                plugins.push({
                    name: line,
                    isInstalled: true
                });
                continue;
            }

            if (parsingData) {
                const parts = line.split(/\s+/);
                if (parts.length >= 1) {
                    plugins.push({
                        name: parts[0],
                        version: parts.length > 1 ? parts[1] : undefined,
                        isInstalled: true
                    });
                }
            }
        }

        return plugins;
    }

    /**
     * Installs a Copilot CLI plugin.
     * @param target The installation target (e.g. OWNER/REPO:PATH)
     */
    public async installPlugin(target: string): Promise<boolean> {
        try {
            await execPromise(`copilot plugin install ${target}`);
            return true;
        } catch (error) {
            console.error('Failed to install Copilot plugin:', error);
            throw new Error(`Failed to install plugin ${target}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Uninstalls a Copilot CLI plugin.
     * @param pluginName The name of the plugin to uninstall.
     */
    public async uninstallPlugin(pluginName: string): Promise<boolean> {
        try {
            await execPromise(`copilot plugin uninstall ${pluginName}`);
            return true;
        } catch (error) {
            console.error('Failed to uninstall Copilot plugin:', error);
            throw new Error(`Failed to uninstall plugin ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
