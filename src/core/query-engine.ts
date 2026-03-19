import { join } from 'path';
import { readJSON, fileExists } from '../utils/fs.js';
import { CONTEXT_DIR, CONTEXT_FILES } from '../constants.js';
import type { Project, Stack, Architecture, Constraints, Decisions } from '../schema/index.js';

// Roughly estimate tokens (1 token ≈ 4 characters for English text)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated to fit token budget]';
}

export type ContextType = 'project' | 'stack' | 'architecture' | 'constraints' | 'decisions';

export const VALID_TYPES: ContextType[] = ['project', 'stack', 'architecture', 'constraints', 'decisions'];

interface ContextData {
  project?: Project;
  stack?: Stack;
  architecture?: Architecture;
  constraints?: Constraints;
  decisions?: Decisions;
}

export interface QueryOptions {
  topic?: string;
  scope?: string;
  type?: ContextType;
  format: 'md' | 'json';
  maxTokens?: number;
}

export interface QueryResult {
  sections: Record<string, unknown>;
  tokenEstimate: number;
}

// Load all context data from .context/ directory
async function loadContext(rootDir: string): Promise<ContextData> {
  const externalRoot = process.env.PRELUDE_ROOT;
  const contextDir = externalRoot
    ? join(externalRoot, rootDir.split('/').pop() as string)
    : join(rootDir, CONTEXT_DIR);

  const data: ContextData = {};

  const loaders: { key: keyof ContextData; file: string }[] = [
    { key: 'project', file: CONTEXT_FILES.PROJECT },
    { key: 'stack', file: CONTEXT_FILES.STACK },
    { key: 'architecture', file: CONTEXT_FILES.ARCHITECTURE },
    { key: 'constraints', file: CONTEXT_FILES.CONSTRAINTS },
    { key: 'decisions', file: CONTEXT_FILES.DECISIONS },
  ];

  for (const { key, file } of loaders) {
    const filePath = join(contextDir, file);
    if (await fileExists(filePath)) {
      data[key] = await readJSON(filePath);
    }
  }

  return data;
}

// Deep-search an object for a keyword match (case-insensitive)
function objectContainsTopic(obj: unknown, topic: string): boolean {
  if (obj === null || obj === undefined) return false;

  if (typeof obj === 'string') {
    return obj.toLowerCase().includes(topic);
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj).toLowerCase().includes(topic);
  }
  if (Array.isArray(obj)) {
    return obj.some(item => objectContainsTopic(item, topic));
  }
  if (typeof obj === 'object') {
    return Object.values(obj).some(val => objectContainsTopic(val, topic));
  }
  return false;
}

// Extract matching sub-fields from an object for a given topic
function extractMatchingFields(obj: Record<string, unknown>, topic: string): Record<string, unknown> {
  const matches: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === '$schema' || key === 'version') continue;

    if (key.toLowerCase().includes(topic) || objectContainsTopic(value, topic)) {
      matches[key] = value;
    }
  }

  return matches;
}

// Filter architecture directories by scope path
function filterArchitectureByScope(arch: Architecture, scope: string): Architecture {
  const normalizedScope = scope.replace(/\/+$/, '').replace(/^\.\//, '');

  const filteredDirs = (arch.directories || []).filter(dir => {
    const normalizedDir = dir.path.replace(/\/+$/, '').replace(/^\.\//, '');
    return normalizedDir.startsWith(normalizedScope) ||
      normalizedScope.startsWith(normalizedDir);
  });

  // Find patterns/conventions relevant to the scoped directories
  const scopeSegments = normalizedScope.toLowerCase().split('/');

  const filteredPatterns = (arch.patterns || []).filter(p => {
    const lower = p.toLowerCase();
    return scopeSegments.some(seg => lower.includes(seg));
  });

  const filteredConventions = (arch.conventions || []).filter(c => {
    const lower = c.toLowerCase();
    return scopeSegments.some(seg => lower.includes(seg));
  });

  const filteredEntryPoints = (arch.entryPoints || []).filter(ep =>
    ep.file.replace(/^\.\//, '').startsWith(normalizedScope)
  );

  return {
    ...arch,
    directories: filteredDirs,
    patterns: filteredPatterns.length > 0 ? filteredPatterns : arch.patterns,
    conventions: filteredConventions.length > 0 ? filteredConventions : arch.conventions,
    entryPoints: filteredEntryPoints.length > 0 ? filteredEntryPoints : undefined,
  };
}

// Filter constraints relevant to a scope (keeps all constraints since they apply globally,
// but highlights relevant directory organization rules)
function filterConstraintsByScope(constraints: Constraints, scope: string): Constraints {
  const normalizedScope = scope.replace(/\/+$/, '').replace(/^\.\//, '').toLowerCase();
  const scopeSegments = normalizedScope.split('/');

  const filteredFileOrg = (constraints.fileOrganization || []).filter(rule => {
    const lower = rule.toLowerCase();
    return scopeSegments.some(seg => lower.includes(seg));
  });

  return {
    ...constraints,
    fileOrganization: filteredFileOrg.length > 0 ? filteredFileOrg : constraints.fileOrganization,
  };
}

// Format query results as markdown
function formatAsMarkdown(sections: Record<string, unknown>): string {
  let md = '# Prelude Query Results\n\n';

  if (sections.project) {
    md += formatProjectSection(sections.project as Partial<Project>);
  }
  if (sections.stack) {
    md += formatStackSection(sections.stack as Partial<Stack>);
  }
  if (sections.architecture) {
    md += formatArchitectureSection(sections.architecture as Partial<Architecture>);
  }
  if (sections.constraints) {
    md += formatConstraintsSection(sections.constraints as Partial<Constraints>);
  }
  if (sections.decisions) {
    md += formatDecisionsSection(sections.decisions as Partial<Decisions>);
  }

  if (md === '# Prelude Query Results\n\n') {
    md += '_No matching context found._\n';
  }

  return md;
}

function formatProjectSection(project: Partial<Project>): string {
  let md = '## Project\n\n';
  if (project.name) md += `**Name:** ${project.name}\n`;
  if (project.description) md += `**Description:** ${project.description}\n`;
  if (project.version) md += `**Version:** ${project.version}\n`;
  if (project.repository) md += `**Repository:** ${project.repository}\n`;
  if (project.license) md += `**License:** ${project.license}\n`;
  if (project.goals && project.goals.length > 0) {
    md += '**Goals:**\n';
    project.goals.forEach(g => { md += `- ${g}\n`; });
  }
  md += '\n';
  return md;
}

function formatStackSection(stack: Partial<Stack>): string {
  let md = '## Stack\n\n';
  if (stack.language) md += `**Language:** ${stack.language}\n`;
  if (stack.runtime) md += `**Runtime:** ${stack.runtime}\n`;
  if (stack.packageManager) md += `**Package Manager:** ${stack.packageManager}\n`;
  if (stack.frameworks?.length) {
    md += '**Frameworks:** ' + stack.frameworks.join(', ') + '\n';
  }
  if (stack.testingFrameworks?.length) {
    md += '**Testing:** ' + stack.testingFrameworks.join(', ') + '\n';
  }
  if (stack.database) md += `**Database:** ${stack.database}\n`;
  if (stack.orm) md += `**ORM:** ${stack.orm}\n`;
  md += '\n';
  return md;
}

function formatArchitectureSection(arch: Partial<Architecture>): string {
  let md = '## Architecture\n\n';
  if (arch.type) md += `**Type:** ${arch.type}\n`;
  if (arch.routing) md += `**Routing:** ${arch.routing}\n`;
  if (arch.apiStyle) md += `**API Style:** ${arch.apiStyle}\n`;
  if (arch.patterns?.length) {
    md += '**Patterns:**\n';
    arch.patterns.forEach(p => { md += `- ${p}\n`; });
  }
  if (arch.conventions?.length) {
    md += '**Conventions:**\n';
    arch.conventions.forEach(c => { md += `- ${c}\n`; });
  }
  if (arch.directories?.length) {
    md += '**Directories:**\n';
    arch.directories.forEach(d => {
      md += `- \`${d.path}\``;
      if (d.purpose) md += ` - ${d.purpose}`;
      md += '\n';
    });
  }
  if (arch.entryPoints?.length) {
    md += '**Entry Points:**\n';
    arch.entryPoints.forEach(ep => {
      md += `- \`${ep.file}\` - ${ep.purpose}\n`;
    });
  }
  md += '\n';
  return md;
}

function formatConstraintsSection(constraints: Partial<Constraints>): string {
  let md = '## Constraints\n\n';
  if (constraints.mustUse?.length) {
    md += '**Must Use:**\n';
    constraints.mustUse.forEach(item => { md += `- ${item}\n`; });
  }
  if (constraints.mustNotUse?.length) {
    md += '**Must Not Use:**\n';
    constraints.mustNotUse.forEach(item => { md += `- ${item}\n`; });
  }
  if (constraints.preferences?.length) {
    md += '**Preferences:**\n';
    constraints.preferences.forEach(p => {
      md += `- [${p.category}] ${p.preference}`;
      if (p.rationale) md += ` _(${p.rationale})_`;
      md += '\n';
    });
  }
  if (constraints.codeStyle) {
    md += '**Code Style:**\n';
    if (constraints.codeStyle.formatter) md += `- Formatter: ${constraints.codeStyle.formatter}\n`;
    if (constraints.codeStyle.linter) md += `- Linter: ${constraints.codeStyle.linter}\n`;
    if (constraints.codeStyle.rules?.length) {
      constraints.codeStyle.rules.forEach(r => { md += `- ${r}\n`; });
    }
  }
  if (constraints.naming) {
    md += '**Naming:**\n';
    const naming = constraints.naming;
    if (naming.files) md += `- Files: ${naming.files}\n`;
    if (naming.components) md += `- Components: ${naming.components}\n`;
    if (naming.functions) md += `- Functions: ${naming.functions}\n`;
    if (naming.variables) md += `- Variables: ${naming.variables}\n`;
  }
  if (constraints.testing) {
    md += '**Testing:**\n';
    md += `- Required: ${constraints.testing.required ? 'Yes' : 'No'}\n`;
    if (constraints.testing.strategy) md += `- Strategy: ${constraints.testing.strategy}\n`;
    if (constraints.testing.coverage) md += `- Coverage: ${constraints.testing.coverage}%\n`;
  }
  if (constraints.fileOrganization?.length) {
    md += '**File Organization:**\n';
    constraints.fileOrganization.forEach(r => { md += `- ${r}\n`; });
  }
  if (constraints.security?.length) {
    md += '**Security:**\n';
    constraints.security.forEach(s => { md += `- ${s}\n`; });
  }
  if (constraints.performance?.length) {
    md += '**Performance:**\n';
    constraints.performance.forEach(p => { md += `- ${p}\n`; });
  }
  if (constraints.accessibility?.length) {
    md += '**Accessibility:**\n';
    constraints.accessibility.forEach(a => { md += `- ${a}\n`; });
  }
  md += '\n';
  return md;
}

function formatDecisionsSection(decisions: Partial<Decisions>): string {
  let md = '## Decisions\n\n';
  const items = decisions.decisions || [];
  if (items.length === 0) return '';

  items.forEach(d => {
    md += `### ${d.title}\n`;
    md += `**Status:** ${d.status}\n`;
    md += `**Rationale:** ${d.rationale}\n`;
    if (d.alternatives?.length) {
      md += '**Alternatives:** ' + d.alternatives.join(', ') + '\n';
    }
    if (d.impact) md += `**Impact:** ${d.impact}\n`;
    if (d.tags?.length) md += `**Tags:** ${d.tags.join(', ')}\n`;
    md += '\n';
  });
  return md;
}

// Strip $schema and version from output
function cleanMetadata(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanMetadata);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '$schema' || key === 'version') continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export async function executeQuery(rootDir: string, options: QueryOptions): Promise<{ output: string; tokenEstimate: number }> {
  const data = await loadContext(rootDir);
  const sections: Record<string, unknown> = {};
  const topic = options.topic?.toLowerCase();

  // Determine which types to include
  const typesToInclude: ContextType[] = options.type
    ? [options.type]
    : VALID_TYPES;

  for (const type of typesToInclude) {
    const raw = data[type];
    if (!raw) continue;

    let section: unknown;

    if (topic) {
      // Topic-based filtering: extract only matching fields
      const matches = extractMatchingFields(raw as Record<string, unknown>, topic);
      if (Object.keys(matches).length > 0) {
        section = matches;
      }
    } else {
      section = raw;
    }

    // Apply scope filtering for architecture and constraints
    if (options.scope && section) {
      if (type === 'architecture') {
        section = filterArchitectureByScope(section as Architecture, options.scope);
      } else if (type === 'constraints') {
        section = filterConstraintsByScope(section as Constraints, options.scope);
      }
    }

    if (section && Object.keys(section as Record<string, unknown>).length > 0) {
      sections[type] = section;
    }
  }

  // Format output
  let output: string;
  if (options.format === 'json') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sections)) {
      cleaned[key] = cleanMetadata(value);
    }
    output = JSON.stringify(cleaned, null, 2);
  } else {
    output = formatAsMarkdown(sections);
  }

  const tokenEstimate = estimateTokens(output);

  // Apply token budget
  if (options.maxTokens && tokenEstimate > options.maxTokens) {
    output = truncateToTokenBudget(output, options.maxTokens);
  }

  return { output, tokenEstimate };
}

function formatCompactProject(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (data.name) parts.push(String(data.name));
  if (data.description) parts.push(String(data.description));
  if (Array.isArray(data.goals) && data.goals.length > 0) {
    parts.push('goals: ' + data.goals.join(', '));
  }
  return parts.length > 0 ? '[project] ' + parts.join(' | ') : '';
}

function formatCompactStack(data: Record<string, unknown>): string {
  const parts: string[] = [];
  const basics = [data.language, data.runtime].filter(Boolean).join(' ');
  if (basics) parts.push(basics);
  if (data.packageManager) parts.push(String(data.packageManager));
  if (Array.isArray(data.frameworks) && data.frameworks.length > 0) {
    parts.push(data.frameworks.join(', '));
  }
  if (Array.isArray(data.testingFrameworks) && data.testingFrameworks.length > 0) {
    parts.push('testing: ' + data.testingFrameworks.join(', '));
  }
  const dbParts = [data.database, data.orm].filter(Boolean);
  if (dbParts.length > 0) parts.push('db: ' + dbParts.join('/'));
  return parts.length > 0 ? '[stack] ' + parts.join(' | ') : '';
}

function formatCompactArchitecture(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (data.type) parts.push('type=' + String(data.type));
  if (Array.isArray(data.patterns) && data.patterns.length > 0) {
    parts.push('patterns: ' + data.patterns.join(', '));
  }
  if (Array.isArray(data.entryPoints) && data.entryPoints.length > 0) {
    const entries = (data.entryPoints as Array<{ file?: string; purpose?: string }>)
      .map(e => e.file || '')
      .filter(Boolean);
    if (entries.length > 0) parts.push('entry: ' + entries.join(', '));
  }
  if (Array.isArray(data.directories) && data.directories.length > 0) {
    const dirs = (data.directories as Array<{ path?: string; purpose?: string }>)
      .map(d => d.purpose ? `${d.path} (${d.purpose})` : d.path || '')
      .filter(Boolean);
    if (dirs.length > 0) parts.push('dirs: ' + dirs.join(', '));
  }
  return parts.length > 0 ? '[arch] ' + parts.join(' | ') : '';
}

function formatCompactConstraints(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(data.mustUse) && data.mustUse.length > 0) {
    parts.push('must-use: ' + data.mustUse.join(', '));
  }
  if (Array.isArray(data.mustNotUse) && data.mustNotUse.length > 0) {
    parts.push('must-not: ' + data.mustNotUse.join(', '));
  }
  const style = data.codeStyle as Record<string, unknown> | undefined;
  if (style) {
    const styleParts = [style.formatter, style.linter].filter(Boolean);
    if (styleParts.length > 0) parts.push('style: ' + styleParts.join('/'));
  }
  const testing = data.testing as Record<string, unknown> | undefined;
  if (testing) {
    const testParts: string[] = [];
    if (testing.strategy) testParts.push(String(testing.strategy));
    if (testing.coverage) testParts.push('coverage: ' + String(testing.coverage) + '%');
    if (testParts.length > 0) parts.push('testing: ' + testParts.join(', '));
  }
  return parts.length > 0 ? '[constraints] ' + parts.join(' | ') : '';
}

function formatCompactDecisions(data: Record<string, unknown>): string {
  const decisions = Array.isArray(data.decisions) ? data.decisions :
    (Array.isArray(data) ? data : []);
  if (decisions.length === 0) return '';
  const items = (decisions as Array<{ title?: string; status?: string }>)
    .map(d => d.title ? `${d.title} (${d.status || 'unknown'})` : '')
    .filter(Boolean);
  return items.length > 0 ? '[decisions] ' + items.join('; ') : '';
}

function formatCompactSection(type: string, data: unknown): string {
  const obj = data as Record<string, unknown>;
  switch (type) {
    case 'project': return formatCompactProject(obj);
    case 'stack': return formatCompactStack(obj);
    case 'architecture': return formatCompactArchitecture(obj);
    case 'constraints': return formatCompactConstraints(obj);
    case 'decisions': return formatCompactDecisions(obj);
    default: return '';
  }
}

export async function exportCompact(
  rootDir: string,
  options: { topic?: string; scope?: string; maxTokens?: number }
): Promise<{ output: string; tokenEstimate: number }> {
  const data = await loadContext(rootDir);
  const sections: Record<string, unknown> = {};
  const topic = options.topic?.toLowerCase();

  for (const type of VALID_TYPES) {
    const raw = data[type];
    if (!raw) continue;

    let section: unknown;

    if (topic) {
      const matches = extractMatchingFields(raw as Record<string, unknown>, topic);
      if (Object.keys(matches).length > 0) {
        section = matches;
      }
    } else {
      section = raw;
    }

    if (options.scope && section) {
      if (type === 'architecture') {
        section = filterArchitectureByScope(section as Architecture, options.scope);
      } else if (type === 'constraints') {
        section = filterConstraintsByScope(section as Constraints, options.scope);
      }
    }

    if (section && Object.keys(section as Record<string, unknown>).length > 0) {
      sections[type] = section;
    }
  }

  const lines: string[] = [];
  for (const [type, sectionData] of Object.entries(sections)) {
    const line = formatCompactSection(type, sectionData);
    if (line) lines.push(line);
  }

  let output = lines.join('\n');
  const tokenEstimate = estimateTokens(output);

  if (options.maxTokens && tokenEstimate > options.maxTokens) {
    output = truncateToTokenBudget(output, options.maxTokens);
  }

  return { output, tokenEstimate };
}
