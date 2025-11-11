export const CONTEXT_DIR = '.context';

export const CONTEXT_FILES = {
  PROJECT: 'project.json',
  STACK: 'stack.json',
  ARCHITECTURE: 'architecture.json',
  CONSTRAINTS: 'constraints.json',
  DECISIONS: 'decisions.json',
  SESSION: 'session.json',
  CHANGELOG: 'changelog.md',
  EXPORT_MD: 'export.md',
  EXPORT_JSON: 'export.json',
  WATCHLOG: '.watchlog.json'
} as const;

export const WATCH_PATTERNS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'tailwind.config.js',
  'tailwind.config.ts',
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'src/**/*',
  'lib/**/*',
  'app/**/*',
  'pages/**/*',
  'components/**/*',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod'
] as const;

export const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.context/**',
  '**/*.test.*',
  '**/*.spec.*'
] as const;