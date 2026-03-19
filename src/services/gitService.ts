import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import * as vscode from 'vscode';
import { TelemetryService } from './telemetry';

export class GitService {
    private useFallback = false;
    private static readonly pathLocks = new Map<string, Promise<void>>();
    private static readonly GIT_CONFIG = ['-c', 'safe.directory=*', '-c', 'core.longpaths=true'];
    private static readonly SIMPLE_GIT_CONFIG = ['safe.directory=*', 'core.longpaths=true'];

    private getSimpleGit(baseDir?: string): SimpleGit {
        return simpleGit({
            baseDir,
            config: GitService.SIMPLE_GIT_CONFIG
        });
    }

    private async gitExec(args: string, cwd?: string): Promise<string> {
        const configStr = GitService.GIT_CONFIG.join(' ');
        return this.execCommand(`git ${configStr} ${args}`, cwd);
    }

    private isKnownGitError(error: any): boolean {
        if (!error) {
            return false;
        }
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('enoent') && msg.includes('spawn git')) {
            return true;
        }
        if (msg.includes('not recognized')) {
            return true;
        }
        if (msg.includes('command not found')) {
            return true;
        }
        if (msg.includes("'git' ") && /[^\x00-\x7F]/.test(msg)) {
            return true;
        }
        if (msg.includes('could not read')) {
            return true;
        }
        // New known errors to reduce noise in error tracker
        if (msg.includes('dubious ownership')) {
            return true;
        }
        if (msg.includes('does not exist')) {
            return true;
        }
        if (msg.includes('not a git repository')) {
            return true;
        }
        if (msg.includes('not a valid repository')) {
            return true;
        }
        if (msg.includes('filename too long')) {
            return true;
        }
        return false;
    }

    private reportFatalError(error: any, contextProps: { [key: string]: string | vscode.TelemetryTrustedValue<string> }): void {
        const props = { ...contextProps, error: (error as Error).message };
        if (this.isKnownGitError(error)) {
            TelemetryService.getInstance().sendEvent('git_known_error', props);
        } else {
            TelemetryService.getInstance().sendError(error as Error, contextProps);
        }
    }

    private normalisePath(p: string): string {
        return path.resolve(p).toLowerCase();
    }

    private async withPathLock<T>(destPath: string, operation: () => Promise<T>): Promise<T> {
        const key = this.normalisePath(destPath);
        const previous = GitService.pathLocks.get(key) ?? Promise.resolve();

        let releaseLock: () => void;
        const lockPromise = new Promise<void>(resolve => {
            releaseLock = resolve;
        });
        GitService.pathLocks.set(key, lockPromise);

        // Wait for any previous operation on the same path to complete
        await previous;

        try {
            return await operation();
        } finally {
            releaseLock!();
            // Clean up if this is the latest lock in the chain
            if (GitService.pathLocks.get(key) === lockPromise) {
                GitService.pathLocks.delete(key);
            }
        }
    }

    public getRepoDirName(repoUrl: string): string {
        const hash = crypto.createHash('md5').update(repoUrl).digest('hex');
        const match = repoUrl.match(/([^\/]+)\/([^\/]+)(?:\.git)?$/);
        if (match) {
            return `${match[1]}_${match[2].replace('.git', '')}_${hash.substring(0, 6)}`;
        }
        return `repo_${hash.substring(0, 8)}`;
    }

    public async cloneOrPullRepo(repoUrl: string, destPath: string): Promise<void> {
        return this.withPathLock(destPath, async () => {
            const gitDir = path.join(destPath, '.git');
            const gitDirExists = fs.existsSync(gitDir);

            if (gitDirExists && !this.isValidGitRepo(destPath)) {
                // Corrupt or incomplete .git directory from a previous failed clone
                console.warn(`Invalid .git directory detected at ${destPath}. Removing and recloning.`);
                let rmSuccess = false;
                for (let i = 0; i < 3; i++) {
                    try {
                        await fs.promises.rm(destPath, { recursive: true, force: true });
                        rmSuccess = true;
                        break;
                    } catch (e) {
                        if (i === 2) {
                            throw new Error(`Failed to remove corrupt directory ${destPath} after 3 attempts: ${e}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, 100)); // Delay before retry
                    }
                }
                if (rmSuccess) {
                    await this.clone(repoUrl, destPath);
                }
            } else if (gitDirExists) {
                this.removeGitLockFiles(destPath);
                await this.pull(destPath);
            } else {
                await this.clone(repoUrl, destPath);
            }
        });
    }

    private async clone(repoUrl: string, destPath: string): Promise<void> {
        const dirExistedBefore = fs.existsSync(destPath);
        try {
            if (!this.useFallback) {
                // Use --no-checkout so we can configure core.longpaths before files are written.
                // This prevents "Filename too long" errors on Windows during the checkout phase.
                await this.gitExec(`clone --depth 1 --single-branch --no-checkout "${repoUrl}" "${destPath}"`);
                // Configure the local repository so settings persist for all future operations.
                await this.applyLocalRepoConfig(destPath);
                // Now perform the checkout with the proper settings in place.
                await this.gitExec(`checkout HEAD -- .`, destPath);
            } else {
                if (!dirExistedBefore) {
                    await fs.promises.mkdir(destPath, { recursive: true });
                }
                await this.cloneFallback(repoUrl, destPath);
            }
        } catch (error) {
            // Clean up partial clone directory if we created it
            if (!dirExistedBefore && fs.existsSync(destPath)) {
                await fs.promises.rm(destPath, { recursive: true, force: true }).catch(() => { });
            }

            if (!this.useFallback) {
                console.warn(`Native git clone failed for ${repoUrl}. Falling back to simple-git. Error: ${error}`);
                TelemetryService.getInstance().sendEvent('native_git_fallback', { context: 'git.clone', repoUrl: new vscode.TelemetryTrustedValue(repoUrl), error: (error as Error).message });
                this.useFallback = true;

                // Recreate directory for fallback attempt
                if (!fs.existsSync(destPath)) {
                    await fs.promises.mkdir(destPath, { recursive: true });
                }
                await this.cloneFallback(repoUrl, destPath);
            } else {
                throw error;
            }
        }
    }

    /**
     * Writes repository-local git config to ensure long path and safe directory
     * settings are persisted for all subsequent operations on this repo.
     * This is necessary because CLI `-c` flags only apply to the current process,
     * not to the local repository configuration.
     */
    private async applyLocalRepoConfig(repoDir: string): Promise<void> {
        await this.gitExec(`config core.longpaths true`, repoDir);
        await this.gitExec(`config safe.directory "${repoDir}"`, repoDir);
    }

    private async pull(destPath: string): Promise<void> {
        this.removeGitLockFiles(destPath);
        try {
            if (!this.useFallback) {
                await this.gitExec(`fetch --depth 1`, destPath);
                await this.gitExec(`reset --hard origin/HEAD`, destPath);
            } else {
                await this.pullFallback(destPath);
            }
        } catch (error) {
            console.warn(`Native git pull failed in ${destPath}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendEvent('native_git_fallback', { context: 'git.pull', destPath, error: (error as Error).message });
            this.useFallback = true;
            await this.pullFallback(destPath);
        }
    }

    private isValidGitRepo(destPath: string): boolean {
        try {
            const headPath = path.join(destPath, '.git', 'HEAD');
            return fs.existsSync(headPath);
        } catch {
            return false;
        }
    }

    private removeGitLockFiles(destPath: string): void {
        const lockFiles = ['index.lock', 'shallow.lock', 'HEAD.lock'];
        for (const lockFile of lockFiles) {
            const lockPath = path.join(destPath, '.git', lockFile);
            try {
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                    console.warn(`Removed stale git lock file: ${lockPath}`);
                }
            } catch (error) {
                console.warn(`Failed to remove git lock file ${lockPath}: ${error}`);
            }
        }
    }

    private async cloneFallback(repoUrl: string, destPath: string): Promise<void> {
        try {
            const git = this.getSimpleGit();
            // Use --no-checkout so we can configure core.longpaths before files are written.
            await git.clone(repoUrl, destPath, ['--depth', '1', '--single-branch', '--no-checkout']);
            // Apply local repo config before checking out files.
            const repoGit = this.getSimpleGit(destPath);
            await repoGit.addConfig('core.longpaths', 'true');
            await repoGit.addConfig('safe.directory', destPath);
            await repoGit.checkout('HEAD');
        } catch (error) {
            this.reportFatalError(error, { context: 'git.cloneFallback', repoUrl: new vscode.TelemetryTrustedValue(repoUrl) });
            throw error;
        }
    }

    private async pullFallback(destPath: string): Promise<void> {
        // Remove any stale lock files left by a previously failed native operation.
        this.removeGitLockFiles(destPath);
        try {
            const git = this.getSimpleGit(destPath);
            // Ensure core.longpaths and safe.directory are configured locally so that
            // repos cloned by older extension versions (which did not write local config)
            // do not fail with "Filename too long" on Windows during reset --hard.
            await git.addConfig('core.longpaths', 'true').catch(() => { });
            await git.addConfig('safe.directory', destPath).catch(() => { });
            await git.fetch(['--depth', '1']);
            await git.raw(['reset', '--hard', 'origin/HEAD']);
        } catch (error) {
            this.reportFatalError(error, { context: 'git.pullFallback', destPath });
            throw error;
        }
    }

    public async mergeUpdate(currentFile: string, baseFile: string, newFile: string): Promise<boolean> {
        try {
            if (!this.useFallback) {
                await this.gitExec(`merge-file "${currentFile}" "${baseFile}" "${newFile}"`);
                return true;
            } else {
                return await this.mergeUpdateFallback(currentFile, baseFile, newFile);
            }
        } catch (error: any) {
            if (error.code && error.code > 0) {
                // git merge-file exits with status > 0 on conflicts
                return false;
            }
            // If it's another error, try fallback
            TelemetryService.getInstance().sendEvent('native_git_fallback', { context: 'git.mergeUpdate.exec', currentFile, error: (error as Error).message });
            if (!this.useFallback) {
                this.useFallback = true;
                return await this.mergeUpdateFallback(currentFile, baseFile, newFile);
            }
            throw error;
        }
    }

    private async mergeUpdateFallback(currentFile: string, baseFile: string, newFile: string): Promise<boolean> {
        try {
            // simple-git allows raw commands, so we run merge-file directly through it
            // We pass a dummy path just to init simpleGit, since merge-file doesn't need a git repo cwd
            const git = this.getSimpleGit(path.dirname(currentFile));
            await git.raw(['merge-file', path.basename(currentFile), baseFile, newFile]);
            return true;
        } catch (error: any) {
            // Raw command error might have exitCode > 0 indicating conflicts
            if (error.message && error.message.includes('conflicts')) {
                return false;
            }
            // For general errors that throw, simple-git throws an error object.
            // If it exits with >0 due to conflicts, simple-git usually throws an async error.
            this.reportFatalError(error, { context: 'git.mergeUpdateFallback', currentFile });
            return false;
        }
    }

    public async getHeadSha(repoDir: string): Promise<string> {
        try {
            if (!this.useFallback) {
                const stdout = await this.gitExec(`rev-parse HEAD`, repoDir);
                return stdout.trim();
            } else {
                return await this.getHeadShaFallback(repoDir);
            }
        } catch (error) {
            console.warn(`Native git rev-parse HEAD failed in ${repoDir}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendEvent('native_git_fallback', { context: 'git.getHeadSha', repoDir, error: (error as Error).message });
            this.useFallback = true;
            return await this.getHeadShaFallback(repoDir);
        }
    }

    private async getHeadShaFallback(repoDir: string): Promise<string> {
        try {
            const git = this.getSimpleGit(repoDir);
            const sha = await git.revparse(['HEAD']);
            return sha.trim();
        } catch (error) {
            this.reportFatalError(error, { context: 'git.getHeadShaFallback', repoDir });
            throw error;
        }
    }

    public async getFileContentAtSha(repoDir: string, sha: string, relativePath: string): Promise<string> {
        if (!/^[a-fA-F0-9]{7,40}$/.test(sha)) {
            throw new Error(`Invalid git SHA provided: ${sha}`);
        }
        try {
            // git show <sha>:<relativePath>
            if (!this.useFallback) {
                // Ensure correct relative path separators for git command
                const gitPath = relativePath.replace(/\\/g, '/');
                const stdout = await this.gitExec(`show ${sha}:"${gitPath}"`, repoDir);
                return stdout;
            } else {
                return await this.getFileContentAtShaFallback(repoDir, sha, relativePath);
            }
        } catch (error) {
            console.warn(`Native git show failed in ${repoDir} for ${sha}:${relativePath}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendEvent('native_git_fallback', { context: 'git.getFileContentAtSha', repoDir, sha, relativePath, error: (error as Error).message });
            this.useFallback = true;
            return await this.getFileContentAtShaFallback(repoDir, sha, relativePath);
        }
    }

    private async getFileContentAtShaFallback(repoDir: string, sha: string, relativePath: string): Promise<string> {
        try {
            const git = this.getSimpleGit(repoDir);
            const gitPath = relativePath.replace(/\\/g, '/');
            const content = await git.show([`${sha}:${gitPath}`]);
            return content;
        } catch (error) {
            this.reportFatalError(error, { context: 'git.getFileContentAtShaFallback', repoDir, sha, relativePath });
            throw error;
        }
    }

    public async getRepoRoot(filePath: string): Promise<string> {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            throw new Error(`Directory does not exist: ${dir}`);
        }

        let current = dir;
        let found = false;
        while (current !== path.parse(current).root) {
            if (fs.existsSync(path.join(current, '.git'))) {
                found = true;
                break;
            }
            current = path.dirname(current);
        }
        if (!found) {
            throw new Error(`Not a git repository: ${dir}`);
        }

        try {
            if (!this.useFallback) {
                const stdout = await this.gitExec(`rev-parse --show-toplevel`, dir);
                return stdout.trim();
            } else {
                return await this.getRepoRootFallback(dir);
            }
        } catch (error) {
            console.warn(`Native git rev-parse --show-toplevel failed in ${dir}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendEvent('native_git_fallback', { context: 'git.getRepoRoot', dir, error: (error as Error).message });
            this.useFallback = true;
            return await this.getRepoRootFallback(dir);
        }
    }

    private async getRepoRootFallback(dir: string): Promise<string> {
        try {
            const git = this.getSimpleGit(dir);
            const root = await git.revparse(['--show-toplevel']);
            return root.trim();
        } catch (error) {
            this.reportFatalError(error, { context: 'git.getRepoRootFallback', dir });
            throw error;
        }
    }

    private execCommand(command: string, cwd?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(command, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    const enhancedError: any = new Error(`${error.message}\nStderr: ${stderr}`);
                    enhancedError.code = error.code;
                    reject(enhancedError);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}
