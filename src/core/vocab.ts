/**
 * Shared directory vocabulary. Used by inferArchitecture() and the map
 * scanner so architecture.json and map.json agree on what a directory is for.
 */

/** Last-path-segment → purpose. Checked exact first, then `includes` fallback. */
export const DIRECTORY_PURPOSES: Record<string, string> = {
  components: 'UI components',
  pages: 'Route pages',
  app: 'Application code',
  lib: 'Shared library code',
  utils: 'Utility functions',
  helpers: 'Utility functions',
  hooks: 'React hooks',
  context: 'React context',
  contexts: 'React context',
  providers: 'Context providers',
  store: 'State management',
  stores: 'State management',
  state: 'State management',
  api: 'API routes',
  routes: 'Route definitions',
  router: 'Route definitions',
  routers: 'Route definitions',
  controllers: 'Request handlers',
  handlers: 'Request handlers',
  services: 'Business logic services',
  core: 'Core business logic',
  domain: 'Domain logic',
  db: 'Database layer',
  database: 'Database layer',
  migrations: 'Database migrations',
  models: 'Data models',
  schema: 'Data schemas',
  schemas: 'Data schemas',
  types: 'Type definitions',
  config: 'Configuration',
  constants: 'Constants',
  public: 'Static assets',
  static: 'Static assets',
  assets: 'Static assets',
  styles: 'Stylesheets',
  tests: 'Tests',
  test: 'Tests',
  __tests__: 'Tests',
  spec: 'Tests',
  e2e: 'End-to-end tests',
  fixtures: 'Test fixtures',
  commands: 'Command handlers',
  cli: 'Command-line interface',
  bin: 'Executable entry points',
  mcp: 'MCP server',
  middleware: 'Middleware',
  workers: 'Background workers',
  jobs: 'Background jobs',
  tasks: 'Background jobs',
  scripts: 'Scripts',
  docs: 'Documentation',
  examples: 'Examples',
  templates: 'Templates',
  views: 'View templates',
  layouts: 'Layout components',
  features: 'Feature modules',
  modules: 'Feature modules',
  packages: 'Workspace packages',
  apps: 'Workspace applications',
  i18n: 'Internationalization',
  locales: 'Internationalization',
  auth: 'Authentication',
  agents: 'Agent implementations',
  pipelines: 'Pipeline stages',
  runtime: 'Runtime environment helpers',
};

// Longest key first so `routers` beats `router` beats `api` in the fallback.
const FALLBACK_KEYS = Object.keys(DIRECTORY_PURPOSES)
  .filter(k => k.length >= 3)
  .sort((a, b) => b.length - a.length || a.localeCompare(b));

/**
 * Infer a directory's purpose from its last path segment only.
 * `src/app/utils` is utilities, not application code.
 */
export function inferDirectoryPurpose(dirPath: string): string | undefined {
  const segments = dirPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const last = segments[segments.length - 1]?.toLowerCase();
  if (!last || last === '.') return undefined;

  if (Object.prototype.hasOwnProperty.call(DIRECTORY_PURPOSES, last)) {
    return DIRECTORY_PURPOSES[last];
  }
  for (const key of FALLBACK_KEYS) {
    if (last.includes(key)) return DIRECTORY_PURPOSES[key];
  }
  return undefined;
}
