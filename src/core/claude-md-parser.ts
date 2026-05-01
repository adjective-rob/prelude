import { readFile } from 'fs/promises';

export interface ClaudeMdData {
  projectName?: string;
  description?: string;
  commands?: { name: string; description: string }[];
  architecture?: {
    type?: string;
    patterns?: string[];
    directories?: { path: string; purpose?: string }[];
  };
  constraints?: {
    mustUse?: string[];
    mustNotUse?: string[];
  };
  conventions?: string[];
  stack?: {
    language?: string;
    frameworks?: string[];
    database?: string;
    testing?: string;
  };
}

interface Section {
  heading: string;
  level: number;
  body: string;
}

/**
 * Parse a CLAUDE.md file and extract structured data.
 * Best-effort — never throws on malformed input.
 */
export async function parseClaudeMd(filePath: string): Promise<ClaudeMdData> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return {};
  }

  const sections = splitSections(content);
  const data: ClaudeMdData = {};

  // Extract project name from first heading
  const firstH1 = sections.find(s => s.level === 1);
  if (firstH1) {
    data.projectName = cleanProjectName(firstH1.heading);
    // Description is the first paragraph after the first heading
    const desc = extractFirstParagraph(firstH1.body);
    if (desc) {
      data.description = desc;
    }
  }

  // If no H1, try the first H2
  if (!data.projectName) {
    const firstH2 = sections.find(s => s.level === 2);
    if (firstH2) {
      // Check if there's text before first section that describes the project
      const preamble = content.split(/^#{1,2}\s/m)[0].trim();
      if (preamble) {
        data.description = extractFirstParagraph(preamble);
      }
    }
  }

  // If no description yet, look for sections with descriptive headings
  if (!data.description) {
    const descSection = findSection(sections, ['what is', 'about', 'overview', 'identity', 'description']);
    if (descSection) {
      const desc = extractFirstParagraph(descSection.body);
      if (desc) data.description = desc;
    }
  }

  // Extract commands
  const cmdSection = findSection(sections, ['commands', 'scripts', 'usage', 'cli commands', 'cli']);
  if (cmdSection) {
    data.commands = extractCommands(cmdSection.body);
  }

  // Extract architecture
  const archSection = findSection(sections, ['architecture', 'structure', 'project structure', 'file structure', 'directory structure']);
  if (archSection) {
    data.architecture = extractArchitecture(archSection.body);
  }

  // If no architecture section, try to extract directory info from any code block with paths
  if (!data.architecture?.directories?.length) {
    for (const section of sections) {
      const dirs = extractDirectoryList(section.body);
      if (dirs.length > 0) {
        if (!data.architecture) data.architecture = {};
        data.architecture.directories = dirs;
        break;
      }
    }
  }

  // Extract constraints and conventions
  const constraintSection = findSection(sections, ['rules', 'constraints', 'important', 'critical rules', 'things to be careful about']);
  const conventionSection = findSection(sections, ['conventions', 'style', 'code style', 'coding standards']);

  if (constraintSection) {
    data.constraints = extractConstraints(constraintSection.body);
    // Also pull conventions from constraint sections
    const convs = extractConventions(constraintSection.body);
    if (convs.length > 0) {
      data.conventions = convs;
    }
  }

  if (conventionSection) {
    const convs = extractConventions(conventionSection.body);
    if (convs.length > 0) {
      data.conventions = [...(data.conventions || []), ...convs];
    }
  }

  // Extract stack info from various sections
  data.stack = extractStackInfo(content, sections);
  if (data.stack && !data.stack.language && !data.stack.frameworks?.length && !data.stack.database && !data.stack.testing) {
    delete (data as any).stack;
  }

  return data;
}

function splitSections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split('\n');
  let currentHeading = '';
  let currentLevel = 0;
  let bodyLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentHeading || bodyLines.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          body: bodyLines.join('\n').trim()
        });
      }
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }

  // Save last section
  if (currentHeading || bodyLines.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      body: bodyLines.join('\n').trim()
    });
  }

  return sections;
}

function findSection(sections: Section[], keywords: string[]): Section | undefined {
  return sections.find(s => {
    const lower = s.heading.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
  });
}

function cleanProjectName(heading: string): string {
  // Remove common prefixes/suffixes like "CLAUDE.md —", "# ", version info
  let name = heading
    .replace(/^CLAUDE\.md\s*[—–-]\s*/i, '')
    .replace(/\s*v\d+\.\d+(\.\d+)?$/i, '')
    .replace(/\s*[—–-]\s*.*$/, '') // Remove everything after em-dash
    .trim();

  // If the heading is just "CLAUDE.md", skip it
  if (/^CLAUDE\.md$/i.test(name)) {
    return '';
  }

  return name;
}

function extractFirstParagraph(text: string): string | undefined {
  const lines = text.split('\n');
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines at the start
    if (paragraphLines.length === 0 && !trimmed) continue;
    // Skip headings, code fences, lists at the start
    if (paragraphLines.length === 0 && (trimmed.startsWith('#') || trimmed.startsWith('```') || trimmed.startsWith('- ') || trimmed.startsWith('* '))) continue;
    // End paragraph at empty line or heading
    if (trimmed === '' && paragraphLines.length > 0) break;
    if (trimmed.startsWith('#')) break;
    if (trimmed.startsWith('```')) break;
    paragraphLines.push(trimmed);
  }

  const result = paragraphLines.join(' ').trim();
  return result.length > 0 ? result : undefined;
}

function extractCommands(body: string): { name: string; description: string }[] {
  const commands: { name: string; description: string }[] = [];

  // Match code blocks with shell commands
  const codeBlockRegex = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(body)) !== null) {
    const block = match[1];
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Extract command and inline comment
      const commentMatch = trimmed.match(/^(.+?)\s+#\s+(.+)$/);
      if (commentMatch) {
        commands.push({ name: commentMatch[1].trim(), description: commentMatch[2].trim() });
      } else {
        commands.push({ name: trimmed, description: '' });
      }
    }
  }

  // Also check for table-style commands: | command | description |
  const tableRows = body.match(/\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/g);
  if (tableRows) {
    for (const row of tableRows) {
      const cells = row.match(/\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/);
      if (cells) {
        commands.push({ name: cells[1].trim(), description: cells[2].trim() });
      }
    }
  }

  // Check for list-style: - `command` — description
  const listRegex = /^[-*]\s+`([^`]+)`\s*[—–-]\s*(.+)$/gm;
  while ((match = listRegex.exec(body)) !== null) {
    commands.push({ name: match[1].trim(), description: match[2].trim() });
  }

  return commands;
}

function extractArchitecture(body: string): ClaudeMdData['architecture'] {
  const arch: NonNullable<ClaudeMdData['architecture']> = {};

  // Detect architecture type from keywords
  const lower = body.toLowerCase();
  if (lower.includes('monorepo')) arch.type = 'monorepo';
  else if (lower.includes('microservice')) arch.type = 'microservices';
  else if (lower.includes('monolith')) arch.type = 'monolith';
  else if (lower.includes('cli') && lower.includes('tool')) arch.type = 'cli';
  else if (lower.includes('library') || lower.includes('sdk')) arch.type = 'library';
  else if (lower.includes('fullstack') || lower.includes('full-stack')) arch.type = 'fullstack';
  else if (lower.includes('backend') && lower.includes('frontend')) arch.type = 'fullstack';
  else if (lower.includes('api') && !lower.includes('frontend')) arch.type = 'backend';

  // Extract patterns
  const patterns: string[] = [];
  const patternKeywords = [
    'mvc', 'mvvm', 'event-driven', 'event driven', 'cqrs', 'pub/sub', 'pubsub',
    'repository pattern', 'factory pattern', 'singleton', 'observer',
    'pipe and filter', 'pipeline', 'layered', 'hexagonal', 'clean architecture',
    'domain-driven', 'ddd', 'serverless', 'microkernel'
  ];
  for (const kw of patternKeywords) {
    if (lower.includes(kw)) {
      patterns.push(kw);
    }
  }
  if (patterns.length > 0) arch.patterns = patterns;

  // Extract directories
  const dirs = extractDirectoryList(body);
  if (dirs.length > 0) arch.directories = dirs;

  return arch;
}

function extractDirectoryList(body: string): { path: string; purpose?: string }[] {
  const dirs: { path: string; purpose?: string }[] = [];

  // Code block with directory tree (path followed by description)
  const codeBlockRegex = /```[^\n]*\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(body)) !== null) {
    const block = match[1];
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      // Match lines like: src/core/    Business logic
      // or: src/core/ — Business logic
      const dirMatch = trimmed.match(/^(\S+\/\S*)\s+[—–-]?\s*(.+)$/);
      if (dirMatch && !dirMatch[1].startsWith('#') && !dirMatch[1].startsWith('$')) {
        dirs.push({ path: dirMatch[1], purpose: dirMatch[2].trim() });
      }
    }
  }

  // Markdown list with paths: - `src/core/` — Business logic
  // or: - src/core/ — Business logic
  const listRegex = /^[-*]\s+`?([^\s`]+\/[^\s`]*)`?\s*[—–-]+\s*(.+)$/gm;
  while ((match = listRegex.exec(body)) !== null) {
    // Avoid duplicates
    const path = match[1];
    if (!dirs.some(d => d.path === path)) {
      dirs.push({ path, purpose: match[2].trim() });
    }
  }

  return dirs;
}

function extractConstraints(body: string): ClaudeMdData['constraints'] {
  const mustUse: string[] = [];
  const mustNotUse: string[] = [];

  const lines = body.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    const trimmed = line.replace(/^[-*\d.)\s]+/, '').replace(/\*\*/g, '').trim();

    if (!trimmed) continue;

    // "must use", "always use", "required"
    if (lower.includes('must use') || lower.includes('always use') || lower.includes('required:')) {
      mustUse.push(trimmed);
    }
    // "must not", "never", "do not", "don't", "avoid"
    else if (lower.includes('must not') || lower.includes('never ') || lower.includes('do not ') ||
             lower.includes("don't") || lower.includes('avoid ') || lower.includes('no ') && lower.includes('use')) {
      mustNotUse.push(trimmed);
    }
  }

  const result: NonNullable<ClaudeMdData['constraints']> = {};
  if (mustUse.length > 0) result.mustUse = mustUse;
  if (mustNotUse.length > 0) result.mustNotUse = mustNotUse;
  return Object.keys(result).length > 0 ? result : undefined;
}

function extractConventions(body: string): string[] {
  const conventions: string[] = [];

  // Extract bullet points as conventions
  const listRegex = /^[-*]\s+\*?\*?(.+?)\*?\*?\s*$/gm;
  let match;
  while ((match = listRegex.exec(body)) !== null) {
    const item = match[1].replace(/\*\*/g, '').trim();
    if (item.length > 10 && item.length < 200) {
      conventions.push(item);
    }
  }

  // Extract numbered list items
  const numberedRegex = /^\d+\.\s+\*?\*?(.+?)\*?\*?\s*$/gm;
  while ((match = numberedRegex.exec(body)) !== null) {
    const item = match[1].replace(/\*\*/g, '').trim();
    if (item.length > 10 && item.length < 200) {
      conventions.push(item);
    }
  }

  return conventions;
}

function extractStackInfo(content: string, sections: Section[]): ClaudeMdData['stack'] | undefined {
  const stack: NonNullable<ClaudeMdData['stack']> = {};
  const lower = content.toLowerCase();

  // Detect language
  const languagePatterns: [RegExp, string][] = [
    [/\btypescript\b/i, 'TypeScript'],
    [/\bpython\s*3?\b/i, 'Python'],
    [/\brust\b/i, 'Rust'],
    [/\bgo\b(?:lang)?/i, 'Go'],
    [/\bruby\b/i, 'Ruby'],
    [/\bjava\b(?!script)/i, 'Java'],
    [/\bkotlin\b/i, 'Kotlin'],
    [/\bswift\b/i, 'Swift'],
    [/\bc#\b|csharp/i, 'C#'],
    [/\bjavascript\b/i, 'JavaScript'],
  ];

  for (const [pattern, lang] of languagePatterns) {
    if (pattern.test(content)) {
      stack.language = lang;
      break;
    }
  }

  // Detect frameworks
  const frameworks: string[] = [];
  const frameworkPatterns: [RegExp, string][] = [
    [/\bnext\.?js\b/i, 'Next.js'],
    [/\breact\b/i, 'React'],
    [/\bvue\b/i, 'Vue'],
    [/\bangular\b/i, 'Angular'],
    [/\bsvelte\b/i, 'Svelte'],
    [/\bexpress\b/i, 'Express'],
    [/\bfastapi\b/i, 'FastAPI'],
    [/\bflask\b/i, 'Flask'],
    [/\bdjango\b/i, 'Django'],
    [/\brails\b/i, 'Rails'],
    [/\bspring\b/i, 'Spring'],
    [/\bactix\b/i, 'Actix'],
    [/\brocket\b/i, 'Rocket'],
    [/\bnuxt\b/i, 'Nuxt'],
    [/\bastro\b/i, 'Astro'],
    [/\bremix\b/i, 'Remix'],
    [/\btailwind\b/i, 'Tailwind CSS'],
  ];

  for (const [pattern, name] of frameworkPatterns) {
    if (pattern.test(content)) {
      frameworks.push(name);
    }
  }
  if (frameworks.length > 0) stack.frameworks = frameworks;

  // Detect database
  const dbPatterns: [RegExp, string][] = [
    [/\bpostgres(?:ql)?\b/i, 'PostgreSQL'],
    [/\bsupabase\b/i, 'Supabase (PostgreSQL)'],
    [/\bmysql\b/i, 'MySQL'],
    [/\bmongodb\b/i, 'MongoDB'],
    [/\bredis\b/i, 'Redis'],
    [/\bsqlite\b/i, 'SQLite'],
    [/\bfirestore\b/i, 'Firestore'],
    [/\bdynamodb\b/i, 'DynamoDB'],
  ];

  for (const [pattern, db] of dbPatterns) {
    if (pattern.test(content)) {
      stack.database = db;
      break;
    }
  }

  // Detect testing framework
  const testPatterns: [RegExp, string][] = [
    [/\bvitest\b/i, 'Vitest'],
    [/\bjest\b/i, 'Jest'],
    [/\bmocha\b/i, 'Mocha'],
    [/\bpytest\b/i, 'pytest'],
    [/\bunittest\b/i, 'unittest'],
    [/\brspec\b/i, 'RSpec'],
    [/\bcypress\b/i, 'Cypress'],
    [/\bplaywright\b/i, 'Playwright'],
  ];

  for (const [pattern, test] of testPatterns) {
    if (pattern.test(content)) {
      stack.testing = test;
      break;
    }
  }

  return (stack.language || stack.frameworks?.length || stack.database || stack.testing) ? stack : undefined;
}
