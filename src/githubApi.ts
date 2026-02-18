import * as https from 'https';
import * as vscode from 'vscode';

export class GithubApi {
    private static readonly MAX_RETRIES = 3;
    private static readonly INITIAL_BACKOFF_MS = 1000;

    public static async fetchJson<T>(url: string): Promise<T> {
        const content = await this.fetch(url);
        return JSON.parse(content);
    }

    public static async fetch(url: string): Promise<string> {
        let retries = 0;
        let lastError: any;

        while (retries <= this.MAX_RETRIES) {
            try {
                return await this.makeRequest(url);
            } catch (error: any) {
                lastError = error;
                if (error.statusCode === 403 || error.statusCode === 429) {
                    const retryAfter = error.headers['retry-after'];
                    let waitTime = this.INITIAL_BACKOFF_MS * Math.pow(2, retries);

                    if (retryAfter) {
                        waitTime = parseInt(retryAfter, 10) * 1000;
                    }

                    // Cap wait time to avoid excessively long hangs (e.g. 60s)
                    if (waitTime > 60000) {
                        // If we have to wait too long, maybe just fail or notify user?
                        // For now, let's just log and throw if it's too long
                        console.warn(`Rate limited. Reset in ${waitTime}ms. Aborting.`);
                        throw error;
                    }

                    console.warn(`Rate limited. Waiting ${waitTime}ms before retry ${retries + 1}/${this.MAX_RETRIES}...`);

                    // Notify user non-intrusively?
                    vscode.window.setStatusBarMessage(`GitHub rate limited. Retrying in ${Math.ceil(waitTime / 1000)}s...`, waitTime);

                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    retries++;
                } else {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    private static makeRequest(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'VSCode-Agent-Manager'
                }
            };
            https.get(url, options, (res) => {
                if (res.statusCode !== 200) {
                    const error: any = new Error(`Request failed with status code ${res.statusCode}`);
                    error.statusCode = res.statusCode;
                    error.headers = res.headers;

                    // Consume data to free memory
                    res.resume();

                    reject(error);
                    return;
                }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', (err) => reject(err));
        });
    }
}
