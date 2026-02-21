import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ParsedMetadata {
    name: string;
    description: string;
    version?: string;
    author?: string;
    tags: string[];
    [key: string]: any;
}

export class MarkdownParser {
    public static extractMetadata(content: string, filePath: string): ParsedMetadata {
        // Parse frontmatter using js-yaml
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(frontmatterRegex);

        let metadata: any = {};
        if (match) {
            try {
                metadata = yaml.load(match[1]) || {};
            } catch (e) {
                console.error(`Error parsing YAML in ${filePath}:`, e);
            }
        }

        // Additional parsing: Look for HTML comments with metadata
        const commentRegex = /<!--\s*(\w+)(?::|\s)\s*(.*?)\s*-->/g;
        let commentMatch;
        while ((commentMatch = commentRegex.exec(content)) !== null) {
            const key = commentMatch[1].toLowerCase();
            const value = commentMatch[2].trim();
            // Only override if not present in frontmatter
            if (!metadata[key]) {
                metadata[key] = value;
            }
        }

        if (!metadata.name) {
            // infer from filename
            // Assume the extension handles both .agent.md and .skill.md or just .md
            const baseName = path.basename(filePath);
            const nameMatch = baseName.match(/^(.*?)(?:\.agent|\.skill)?\.md$/);
            metadata.name = nameMatch ? nameMatch[1] : baseName;
        }

        // Clean up name
        let name = metadata.name;
        if (typeof name === 'string') {
            name = name.replace(/^['"]+|['"]+$/g, '').trim();
        }

        // Ensure tags is a string array
        let tags: string[] = [];
        if (Array.isArray(metadata.tags)) {
            tags = metadata.tags.map((t: any) => String(t));
        } else if (typeof metadata.tags === 'string') {
            tags = metadata.tags.split(',').map((t: string) => t.trim());
        }

        return {
            ...metadata,
            name: name,
            description: metadata.description?.toString() || 'No description provided.',
            version: metadata.version?.toString(),
            author: metadata.author?.toString(),
            tags: tags,
        };
    }
}
