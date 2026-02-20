import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import { TelemetryService } from './telemetry';

export class GitService {
    private useFallback = false;

    public getRepoDirName(repoUrl: string): string {
        const hash = crypto.createHash('md5').update(repoUrl).digest('hex');
        const match = repoUrl.match(/([^\/]+)\/([^\/]+)(?:\.git)?$/);
        if (match) {
            return `${match[1]}_${match[2].replace('.git', '')}_${hash.substring(0, 6)}`;
        }
        return `repo_${hash.substring(0, 8)}`;
    }

    public async cloneOrPullRepo(repoUrl: string, destPath: string): Promise<void> {
        const isRepo = fs.existsSync(path.join(destPath, '.git'));
        if (isRepo) {
            await this.pull(destPath);
        } else {
            await this.clone(repoUrl, destPath);
        }
    }

    private async clone(repoUrl: string, destPath: string): Promise<void> {
        try {
            if (!fs.existsSync(destPath)) {
                await fs.promises.mkdir(destPath, { recursive: true });
            }

            if (!this.useFallback) {
                await this.execCommand(`git clone --depth 1 --single-branch "${repoUrl}" "${destPath}"`);
            } else {
                await this.cloneFallback(repoUrl, destPath);
            }
        } catch (error) {
            console.warn(`Native git clone failed for ${repoUrl}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.clone', repoUrl });
            this.useFallback = true;
            await this.cloneFallback(repoUrl, destPath);
        }
    }

    private async pull(destPath: string): Promise<void> {
        try {
            if (!this.useFallback) {
                await this.execCommand(`git fetch --depth 1`, destPath);
                await this.execCommand(`git reset --hard origin/HEAD`, destPath);
            } else {
                await this.pullFallback(destPath);
            }
        } catch (error) {
            console.warn(`Native git pull failed in ${destPath}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.pull', destPath });
            this.useFallback = true;
            await this.pullFallback(destPath);
        }
    }

    private async cloneFallback(repoUrl: string, destPath: string): Promise<void> {
        try {
            const git: SimpleGit = simpleGit();
            await git.clone(repoUrl, destPath, ['--depth', '1', '--single-branch']);
        } catch (error) {
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.cloneFallback', repoUrl });
            throw error;
        }
    }

    private async pullFallback(destPath: string): Promise<void> {
        try {
            const git: SimpleGit = simpleGit(destPath);
            await git.fetch(['--depth', '1']);
            await git.raw(['reset', '--hard', 'origin/HEAD']);
        } catch (error) {
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.pullFallback', destPath });
            throw error;
        }
    }

    public async mergeUpdate(currentFile: string, baseFile: string, newFile: string): Promise<boolean> {
        try {
            if (!this.useFallback) {
                await this.execCommand(`git merge-file "${currentFile}" "${baseFile}" "${newFile}"`);
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
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.mergeUpdate.exec', currentFile });
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
            const git: SimpleGit = simpleGit(path.dirname(currentFile));
            await git.raw(['merge-file', path.basename(currentFile), baseFile, newFile]);
            return true;
        } catch (error: any) {
            // Raw command error might have exitCode > 0 indicating conflicts
            if (error.message && error.message.includes('conflicts')) {
                return false;
            }
            // For general errors that throw, simple-git throws an error object.
            // If it exits with >0 due to conflicts, simple-git usually throws an async error.
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.mergeUpdateFallback', currentFile });
            return false;
        }
    }

    public async getHeadSha(repoDir: string): Promise<string> {
        try {
            if (!this.useFallback) {
                const stdout = await this.execCommand(`git rev-parse HEAD`, repoDir);
                return stdout.trim();
            } else {
                return await this.getHeadShaFallback(repoDir);
            }
        } catch (error) {
            console.warn(`Native git rev-parse HEAD failed in ${repoDir}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.getHeadSha', repoDir });
            this.useFallback = true;
            return await this.getHeadShaFallback(repoDir);
        }
    }

    private async getHeadShaFallback(repoDir: string): Promise<string> {
        try {
            const git: SimpleGit = simpleGit(repoDir);
            const sha = await git.revparse(['HEAD']);
            return sha.trim();
        } catch (error) {
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.getHeadShaFallback', repoDir });
            throw error;
        }
    }

    public async getFileContentAtSha(repoDir: string, sha: string, relativePath: string): Promise<string> {
        try {
            // git show <sha>:<relativePath>
            if (!this.useFallback) {
                // Ensure correct relative path separators for git command
                const gitPath = relativePath.replace(/\\/g, '/');
                const stdout = await this.execCommand(`git show ${sha}:"${gitPath}"`, repoDir);
                return stdout;
            } else {
                return await this.getFileContentAtShaFallback(repoDir, sha, relativePath);
            }
        } catch (error) {
            console.warn(`Native git show failed in ${repoDir} for ${sha}:${relativePath}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.getFileContentAtSha', repoDir, sha, relativePath });
            this.useFallback = true;
            return await this.getFileContentAtShaFallback(repoDir, sha, relativePath);
        }
    }

    private async getFileContentAtShaFallback(repoDir: string, sha: string, relativePath: string): Promise<string> {
        try {
            const git: SimpleGit = simpleGit(repoDir);
            const gitPath = relativePath.replace(/\\/g, '/');
            const content = await git.show([`${sha}:${gitPath}`]);
            return content;
        } catch (error) {
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.getFileContentAtShaFallback', repoDir, sha, relativePath });
            throw error;
        }
    }

    public async getRepoRoot(filePath: string): Promise<string> {
        const dir = path.dirname(filePath);
        try {
            if (!this.useFallback) {
                const stdout = await this.execCommand(`git rev-parse --show-toplevel`, dir);
                return stdout.trim();
            } else {
                return await this.getRepoRootFallback(dir);
            }
        } catch (error) {
            console.warn(`Native git rev-parse --show-toplevel failed in ${dir}. Falling back to simple-git. Error: ${error}`);
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.getRepoRoot', dir });
            this.useFallback = true;
            return await this.getRepoRootFallback(dir);
        }
    }

    private async getRepoRootFallback(dir: string): Promise<string> {
        try {
            const git: SimpleGit = simpleGit(dir);
            const root = await git.revparse(['--show-toplevel']);
            return root.trim();
        } catch (error) {
            TelemetryService.getInstance().sendError(error as Error, { context: 'git.getRepoRootFallback', dir });
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
