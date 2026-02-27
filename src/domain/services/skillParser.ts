import { Skill } from '../models/skill';
import { MarkdownParser } from './markdownParser';

export class SkillParser {
    public static parse(content: string, repo: string, filePath: string, baseDirectory?: string): Skill | null {
        const metadata = MarkdownParser.extractMetadata(content, filePath);

        return {
            id: `${repo}:${filePath}`,
            type: 'skill',
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
