import * as assert from "assert";
import * as sinon from "sinon";
import * as fs from "fs";
import * as path from "path";
import { GitService } from "../services/gitService";

suite("GitService Test Suite", () => {
    let sandbox: sinon.SinonSandbox;
    let gitService: GitService;

    setup(() => {
        sandbox = sinon.createSandbox();
        gitService = new GitService();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("getRepoDirName", () => {
        test("returns formatted dir name for standard GitHub URL", () => {
            const dirName = gitService.getRepoDirName(
                "https://github.com/owner/repo"
            );
            assert.ok(dirName.startsWith("owner_repo_"));
            assert.ok(dirName.length > "owner_repo_".length);
        });

        test("returns formatted dir name for URL with .git suffix", () => {
            const dirName = gitService.getRepoDirName(
                "https://github.com/owner/repo.git"
            );
            assert.ok(dirName.startsWith("owner_repo_"));
        });

        test("returns fallback name for non-standard URL", () => {
            const dirName = gitService.getRepoDirName("some-url");
            assert.ok(dirName.startsWith("repo_"));
        });
    });

    suite("cloneOrPullRepo", () => {
        test("clones when .git directory does not exist", async () => {
            const existsSyncStub = sandbox.stub(fs, "existsSync");
            existsSyncStub.withArgs("/dest/.git").returns(false);
            existsSyncStub.withArgs("/dest").returns(false);

            sandbox
                .stub(fs.promises, "mkdir")
                .resolves(undefined as unknown as string);

            const execStub = sandbox.stub(
                gitService as any,
                "execCommand"
            ).resolves("");

            await gitService.cloneOrPullRepo("https://github.com/o/r", "/dest");

            assert.ok(
                execStub.calledWith(
                    'git clone --depth 1 --single-branch "https://github.com/o/r" "/dest"'
                )
            );
        });

        test("pulls when valid .git directory exists", async () => {
            const existsSyncStub = sandbox.stub(fs, "existsSync");
            existsSyncStub.withArgs("/dest/.git").returns(true);
            // isValidGitRepo check
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "HEAD"))
                .returns(true);
            // removeGitLockFiles checks
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "index.lock"))
                .returns(false);
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "shallow.lock"))
                .returns(false);
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "HEAD.lock"))
                .returns(false);

            const execStub = sandbox.stub(
                gitService as any,
                "execCommand"
            ).resolves("");

            await gitService.cloneOrPullRepo("https://github.com/o/r", "/dest");

            assert.ok(execStub.calledWith("git fetch --depth 1", "/dest"));
            assert.ok(
                execStub.calledWith("git reset --hard origin/HEAD", "/dest")
            );
        });

        test("removes corrupt .git directory and reclones", async () => {
            const existsSyncStub = sandbox.stub(fs, "existsSync");
            existsSyncStub.withArgs("/dest/.git").returns(true);
            // isValidGitRepo returns false (no HEAD)
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "HEAD"))
                .returns(false);
            // After rm, clone checks dir doesn't exist
            existsSyncStub.withArgs("/dest").returns(false);

            const rmStub = sandbox.stub(fs.promises, "rm").resolves();
            sandbox
                .stub(fs.promises, "mkdir")
                .resolves(undefined as unknown as string);

            const execStub = sandbox.stub(
                gitService as any,
                "execCommand"
            ).resolves("");
            sandbox.stub(console, "warn");

            await gitService.cloneOrPullRepo("https://github.com/o/r", "/dest");

            assert.ok(rmStub.calledWith("/dest", { recursive: true, force: true }));
            assert.ok(
                execStub.calledWith(
                    'git clone --depth 1 --single-branch "https://github.com/o/r" "/dest"'
                )
            );
        });

        test("removes stale lock files before pulling", async () => {
            const existsSyncStub = sandbox.stub(fs, "existsSync");
            existsSyncStub.withArgs("/dest/.git").returns(true);
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "HEAD"))
                .returns(true);
            // Lock file exists
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "index.lock"))
                .returns(true);
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "shallow.lock"))
                .returns(false);
            existsSyncStub
                .withArgs(path.join("/dest", ".git", "HEAD.lock"))
                .returns(false);

            const unlinkSyncStub = sandbox.stub(fs, "unlinkSync");
            sandbox.stub(console, "warn");
            sandbox.stub(gitService as any, "execCommand").resolves("");

            await gitService.cloneOrPullRepo("https://github.com/o/r", "/dest");

            assert.ok(
                unlinkSyncStub.calledWith(
                    path.join("/dest", ".git", "index.lock")
                )
            );
        });
    });

    suite("clone failure cleanup", () => {
        test("cleans up newly created directory on clone failure", async () => {
            const existsSyncStub = sandbox.stub(fs, "existsSync");
            // cloneOrPullRepo: .git doesn't exist
            existsSyncStub.withArgs("/dest/.git").returns(false);
            // clone: dir didn't exist before
            existsSyncStub.withArgs("/dest").onFirstCall().returns(false);
            // After failure, dir exists (needs cleanup)
            existsSyncStub.withArgs("/dest").onSecondCall().returns(true);
            // Fallback mkdir check
            existsSyncStub.withArgs("/dest").onThirdCall().returns(false);

            sandbox
                .stub(fs.promises, "mkdir")
                .resolves(undefined as unknown as string);

            const rmStub = sandbox.stub(fs.promises, "rm").resolves();

            const execStub = sandbox.stub(gitService as any, "execCommand");
            execStub.rejects(new Error("clone failed"));

            // Stub simple-git fallback to succeed
            sandbox.stub(gitService as any, "cloneFallback").resolves();
            sandbox.stub(console, "warn");

            // Stub telemetry
            const telemetryStub = {
                sendError: sandbox.stub(),
            };
            sandbox.stub(
                require("../services/telemetry").TelemetryService,
                "getInstance"
            ).returns(telemetryStub);

            await gitService.cloneOrPullRepo("https://github.com/o/r", "/dest");

            assert.ok(
                rmStub.calledWith("/dest", { recursive: true, force: true })
            );
        });
    });

    suite("per-path semaphore", () => {
        test("serialises concurrent operations on the same path", async () => {
            const executionOrder: number[] = [];
            let callCount = 0;

            const existsSyncStub = sandbox.stub(fs, "existsSync");
            // Both calls see no .git dir → clone path
            existsSyncStub.returns(false);
            sandbox.stub(console, "warn");

            sandbox
                .stub(fs.promises, "mkdir")
                .resolves(undefined as unknown as string);

            const execStub = sandbox.stub(gitService as any, "execCommand");
            execStub.callsFake(async () => {
                const myCall = ++callCount;
                executionOrder.push(myCall);
                // Simulate async work
                await new Promise(resolve => setTimeout(resolve, 20));
                executionOrder.push(myCall * 10);
                return "";
            });

            // Fire two concurrent operations on the same path
            const op1 = gitService.cloneOrPullRepo("https://github.com/o/r1", "/dest");
            const op2 = gitService.cloneOrPullRepo("https://github.com/o/r2", "/dest");

            await Promise.all([op1, op2]);

            // First operation should fully complete (1, 10) before second starts (2, 20)
            assert.strictEqual(executionOrder[0], 1, "op1 should start first");
            assert.strictEqual(executionOrder[1], 10, "op1 should finish before op2 starts");
            assert.strictEqual(executionOrder[2], 2, "op2 should start after op1 finishes");
            assert.strictEqual(executionOrder[3], 20, "op2 should finish last");
        });

        test("allows concurrent operations on different paths", async () => {
            const activePaths: string[] = [];
            let concurrentMax = 0;
            let concurrentCurrent = 0;

            const existsSyncStub = sandbox.stub(fs, "existsSync");
            existsSyncStub.returns(false);
            sandbox.stub(console, "warn");

            sandbox
                .stub(fs.promises, "mkdir")
                .resolves(undefined as unknown as string);

            const execStub = sandbox.stub(gitService as any, "execCommand");
            execStub.callsFake(async () => {
                concurrentCurrent++;
                if (concurrentCurrent > concurrentMax) {
                    concurrentMax = concurrentCurrent;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
                concurrentCurrent--;
                return "";
            });

            // Fire two concurrent operations on different paths
            const op1 = gitService.cloneOrPullRepo("https://github.com/o/r", "/dest1");
            const op2 = gitService.cloneOrPullRepo("https://github.com/o/r", "/dest2");

            await Promise.all([op1, op2]);

            // Both should run concurrently
            assert.ok(concurrentMax >= 2, `Expected concurrent execution, but max was ${concurrentMax}`);
        });

        test("releases lock when operation fails", async () => {
            const existsSyncStub = sandbox.stub(fs, "existsSync");
            existsSyncStub.returns(false);
            sandbox.stub(console, "warn");

            sandbox
                .stub(fs.promises, "mkdir")
                .resolves(undefined as unknown as string);
            sandbox.stub(fs.promises, "rm").resolves();

            const execStub = sandbox.stub(gitService as any, "execCommand");
            // First call: native fails, fallback also fails
            execStub.onFirstCall().rejects(new Error("clone failed"));

            const cloneFallbackStub = sandbox.stub(gitService as any, "cloneFallback");
            cloneFallbackStub.onFirstCall().rejects(new Error("fallback also failed"));
            cloneFallbackStub.onSecondCall().resolves();

            const telemetryStub = {
                sendError: sandbox.stub(),
            };
            sandbox.stub(
                require("../services/telemetry").TelemetryService,
                "getInstance"
            ).returns(telemetryStub);

            // First call should fail
            let firstFailed = false;
            try {
                await gitService.cloneOrPullRepo("https://github.com/o/r", "/dest");
            } catch {
                firstFailed = true;
            }
            assert.ok(firstFailed, "First operation should have failed");

            // Reset the useFallback so native path is tried again
            (gitService as any).useFallback = false;
            execStub.onSecondCall().resolves("");

            // Second call should succeed — lock was released despite the failure
            await gitService.cloneOrPullRepo("https://github.com/o/r2", "/dest");
        });
    });
});
