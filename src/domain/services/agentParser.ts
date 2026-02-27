import { Agent } from '../models/agent';
import { MarkdownParser } from './markdownParser';

export class AgentParser {
    public static parse(content: string, repo: string, filePath: string, baseDirectory?: string): Agent | null {
        const metadata = MarkdownParser.extractMetadata(content, filePath);

        return {
            id: `${repo}:${filePath}`,
            type: 'agent',
            name: metadata.name,
            description: metadata.description,
            version: metadata.version,
            author: metadata.author,
            tags: metadata.tags,
            repository: repo,
            path: filePath,
            installUrl: filePath,
            baseDirectory
        };
    }
}
