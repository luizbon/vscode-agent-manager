import * as assert from 'assert';
import { MarkdownParser } from '../domain/services/markdownParser';
import * as sinon from 'sinon';

suite('MarkdownParser Test Suite', () => {

    teardown(() => {
        sinon.restore();
    });

    test('Should parse metadata with Unix line endings', () => {
        const content = `---\nname: unix-skill\ndescription: A skill with unix line endings\n---\n# Unix Skill`;
        const result = MarkdownParser.extractMetadata(content, 'test-skill.md');

        assert.strictEqual(result.name, 'unix-skill');
        assert.strictEqual(result.description, 'A skill with unix line endings');
    });

    test('Should parse metadata with Windows CRLF line endings', () => {
        const content = `---\r\nname: win-skill\r\ndescription: A skill with windows line endings\r\n---\r\n# Windows Skill`;
        const result = MarkdownParser.extractMetadata(content, 'test-skill.md');

        assert.strictEqual(result.name, 'win-skill');
        assert.strictEqual(result.description, 'A skill with windows line endings');
    });

    test('Should fallback to filename if no name provided', () => {
        const content = `---\ndescription: Missing name\n---\n# No Name`;
        const result = MarkdownParser.extractMetadata(content, 'missing-name.skill.md');

        assert.strictEqual(result.name, 'missing-name');
    });

    test('Should parse HTML comments successfully', () => {
        const content = `<!-- name: html-skill -->\n<!-- description: from comment -->\n# Skill`;
        const result = MarkdownParser.extractMetadata(content, 'test.md');

        assert.strictEqual(result.name, 'html-skill');
        assert.strictEqual(result.description, 'from comment');
    });
});
