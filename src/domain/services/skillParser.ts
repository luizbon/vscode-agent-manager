import * as path from 'path';
import { Skill } from '../models/skill';
import { MarkdownParser } from './markdownParser';

export class SkillParser {
    public static parse(content: string, repo: string, filePath: string, baseDirectory?: string): Skill | null {
        const metadata = MarkdownParser.extractMetadata(content, filePath);
        const fileName = path.basename(filePath).toLowerCase();
        const isDedicatedSkillFile = fileName === 'skill.md' || fileName.endsWith('.skill.md');

        // If it has a type and it is NOT skill, it's not for us
        if (metadata.type && metadata.type.toLowerCase() !== 'skill') {
            return null;
        }

        if (!isDedicatedSkillFile && !metadata.hasExplicitMetadata) {
            return null;
        }

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
