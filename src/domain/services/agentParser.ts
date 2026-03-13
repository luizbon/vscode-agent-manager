import { Agent } from '../models/agent';
import { MarkdownParser } from './markdownParser';

export class AgentParser {
    public static parse(content: string, repo: string, filePath: string, baseDirectory?: string): Agent | null {
        const metadata = MarkdownParser.extractMetadata(content, filePath);
        const fileName = filePath.toLowerCase();
        const isDedicatedAgentFile = fileName.endsWith('.agent.md');

        // If it has a type and it is NOT agent, it's not for us
        if (metadata.type && metadata.type.toLowerCase() !== 'agent') {
            return null;
        }

        if (!isDedicatedAgentFile && !metadata.hasExplicitMetadata) {
            return null;
        }

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
