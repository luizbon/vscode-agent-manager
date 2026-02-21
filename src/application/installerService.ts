import * as fs from 'fs';
import * as path from 'path';
import * as upath from 'upath';
import * as os from 'os';
import { IMarketplaceItem } from '../domain/models/marketplaceItem';
import { GitService } from '../services/gitService';

export interface IStateStore {
    get(key: string, isGlobal: boolean): Promise<string | undefined>;
    update(key: string, value: string, isGlobal: boolean): Promise<void>;
}

export interface IConflictResolver {
    resolve(item: IMarketplaceItem, targetPath: string): Promise<'override' | 'cancel' | 'manual'>;
}

export class InstallerService {
    constructor(
        private stateStore: IStateStore,
        private conflictResolver: IConflictResolver,
        private isUserGlobalFn: (pathToCheck: string) => boolean
    ) { }

    private getStateKey(installPath: string): string {
        return `itemSha:${installPath}`;
    }

    public async copyItemFile(sourcePath: string, destPath: string): Promise<void> {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.copyFile(sourcePath, destPath);
    }

    public async updateItem(item: IMarketplaceItem, targetPath: string): Promise<string> {
        const gitService = new GitService();
        let repoRoot = '';
        let currentSha = '';
        let relativePath = '';

        try {
            repoRoot = await gitService.getRepoRoot(item.installUrl);
            currentSha = await gitService.getHeadSha(repoRoot);
            relativePath = path.relative(repoRoot, item.installUrl);
        } catch (e) {
            throw new Error(`Failed to determine git details for item: ${e}`);
        }

        const isGlobal = this.isUserGlobalFn(targetPath);
        const stateKey = this.getStateKey(targetPath);
        let baseSha = await this.stateStore.get(stateKey, isGlobal);

        const hasLocalFile = fs.existsSync(targetPath);
        const legacyBasePath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.base`);
        const hasLegacyBase = fs.existsSync(legacyBasePath);

        if ((baseSha || hasLegacyBase) && hasLocalFile) {
            const currentContent = await fs.promises.readFile(targetPath, 'utf-8');
            let baseContent = '';

            if (baseSha) {
                try {
                    baseContent = await gitService.getFileContentAtSha(repoRoot, baseSha, relativePath);
                } catch (e) {
                    baseContent = currentContent;
                }
            } else if (hasLegacyBase) {
                baseContent = await fs.promises.readFile(legacyBasePath, 'utf-8');
            }

            const newContent = await fs.promises.readFile(item.installUrl, 'utf-8');

            const baseTempPath = path.join(os.tmpdir(), `base_${Date.now()}_${path.basename(targetPath)}`);
            const newTempPath = path.join(os.tmpdir(), `new_${Date.now()}_${path.basename(targetPath)}`);

            if (currentContent !== baseContent) {
                const targetBackup = targetPath + '.bak';
                await fs.promises.copyFile(targetPath, targetBackup);

                await fs.promises.writeFile(baseTempPath, baseContent, 'utf-8');
                await fs.promises.writeFile(newTempPath, newContent, 'utf-8');

                const success = await gitService.mergeUpdate(targetPath, baseTempPath, newTempPath);

                await fs.promises.unlink(baseTempPath).catch(() => { });
                await fs.promises.unlink(newTempPath).catch(() => { });

                if (!success) {
                    const choice = await this.conflictResolver.resolve(item, targetPath);

                    if (choice === 'cancel') {
                        await fs.promises.copyFile(targetBackup, targetPath);
                        await fs.promises.unlink(targetBackup).catch(() => { });
                        return 'cancelled';
                    } else if (choice === 'override') {
                        await this.copyItemFile(item.installUrl, targetPath);
                    }
                }
                await fs.promises.unlink(targetBackup).catch(() => { });
            } else {
                await this.copyItemFile(item.installUrl, targetPath);
            }
        } else {
            await this.copyItemFile(item.installUrl, targetPath);
        }

        await this.stateStore.update(this.getStateKey(targetPath), currentSha, isGlobal);

        if (hasLegacyBase) {
            await fs.promises.unlink(legacyBasePath).catch(() => { });
        }

        return 'updated';
    }

    public async installItem(item: IMarketplaceItem, installBasePath: string): Promise<void> {
        const gitService = new GitService();
        let repoRoot = '';
        let currentSha = '';
        try {
            repoRoot = await gitService.getRepoRoot(item.installUrl);
            currentSha = await gitService.getHeadSha(repoRoot);
        } catch (e) {
            throw new Error(`Failed to determine git details for item: ${e}`);
        }

        const fileName = path.basename(item.path);
        let finalInstallPath = installBasePath;

        // If it's a skill and has a base directory, replicate the structure
        if (item.baseDirectory) {
            // Check for multi-level baseDirectory and log a warning
            if (item.baseDirectory.includes('/') || item.baseDirectory.includes('\\')) {
                console.warn(`Warning: item.baseDirectory "${item.baseDirectory}" contains path separators. This might indicate an unexpected structure. It will be normalized.`);
            }
            // Re-normalize to ensure no absolute paths or parent traversal
            const safeBaseDir = upath.toUnix(item.baseDirectory).split('/').filter((p: string) => p && p !== '..').join('/');
            finalInstallPath = upath.join(installBasePath, safeBaseDir);
        }

        const fullTargetPath = upath.join(finalInstallPath, fileName);

        await this.copyItemFile(item.installUrl, fullTargetPath);
        await this.stateStore.update(this.getStateKey(fullTargetPath), currentSha, this.isUserGlobalFn(fullTargetPath));
    }
}
