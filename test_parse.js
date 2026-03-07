"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const markdownParser_1 = require("./src/domain/services/markdownParser");
const content = `---\nname: appinsights-instrumentation\ndescription: 'Instrument a webapp to send useful telemetry data to Azure App Insights'\n---\n# AppInsights instrumentation`;
const result = markdownParser_1.MarkdownParser.extractMetadata(content, 'skills/appinsights-instrumentation/SKILL.md');
console.log('Result for SKILL.md with frontmatter:', result);
const noFrontmatter = `# AppInsights instrumentation`;
const result2 = markdownParser_1.MarkdownParser.extractMetadata(noFrontmatter, 'skills/appinsights-instrumentation/SKILL.md');
console.log('Result for SKILL.md without frontmatter:', result2);
const crlfContent = `---\r\nname: appinsights-instrumentation\r\ndescription: 'Instrument a webapp to send useful telemetry data to Azure App Insights'\r\n---\r\n# AppInsights instrumentation`;
const result3 = markdownParser_1.MarkdownParser.extractMetadata(crlfContent, 'skills/appinsights-instrumentation/SKILL.md');
console.log('Result for CRLF SKILL.md:', result3);
//# sourceMappingURL=test_parse.js.map