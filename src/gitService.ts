import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';

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
            this.useFallback = true;
            await this.pullFallback(destPath);
        }
    }

    private async cloneFallback(repoUrl: string, destPath: string): Promise<void> {
        const git: SimpleGit = simpleGit();
        await git.clone(repoUrl, destPath, ['--depth', '1', '--single-branch']);
    }

    private async pullFallback(destPath: string): Promise<void> {
        const git: SimpleGit = simpleGit(destPath);
        await git.fetch(['--depth', '1']);
        await git.raw(['reset', '--hard', 'origin/HEAD']);
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
            return false;
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
