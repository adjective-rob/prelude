import { readdir, stat, readFile } from 'fs/promises';
import { join, basename, relative } from 'path';
import { fileExists, readJSON, getDirectoryTree } from '../utils/fs.js';
import { getCurrentTimestamp } from '../utils/time.js';
import type { Project, Stack, Architecture, Constraints } from '../schema/index.js';
import { scanSources } from './source-scanner.js';

// --- ADD THESE CONSTANTS ---
const PRELUDE_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";
// --------------------------

// --- Minimal pyproject.toml parser ---

function setNested(obj: Record<string, any>, table: string, key: string, value: any): void {
  const parts = table ? table.split('.') : [];
  let current = obj;
  for (const part of parts) {
    if (!(part in current)) current[part] = {};
    current = current[part];
  }
  current[key] = value;
}

function parsePyprojectToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentTable = '';
  let collectingArray: any[] | null = null;
  let collectingKey = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      if (collectingArray !== null) continue;
      continue;
    }

    // Handle multiline array continuation
    if (collectingArray !== null) {
      if (trimmed === ']') {
        setNested(result, currentTable, collectingKey, collectingArray);
        collectingArray = null;
        continue;
      }
      // Inline table in array: {key = "value", ...}
      if (trimmed.startsWith('{')) {
        const obj: Record<string, string> = {};
        const pairPattern = /(\w+)\s*=\s*["']([^"']*)["']/g;
        let m;
        while ((m = pairPattern.exec(trimmed)) !== null) {
          obj[m[1]] = m[2];
        }
        if (Object.keys(obj).length > 0) collectingArray.push(obj);
        continue;
      }
      // String in array: "value",
      const strMatch = trimmed.match(/^["']([^"']*)["']/);
      if (strMatch) {
        collectingArray.push(strMatch[1]);
      }
      continue;
    }

    // Table header: [section] or [section.subsection]
    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^([a-zA-Z_-][a-zA-Z0-9_.-]*)\s*=\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim();
    const rawValue = kvMatch[2].trim();

    if (rawValue === '[') {
      collectingArray = [];
      collectingKey = key;
    } else if (rawValue.startsWith('[')) {
      // Inline array
      const items: any[] = [];
      // Check for inline tables in array
      const inlineTablePattern = /\{([^}]+)\}/g;
      let itMatch;
      while ((itMatch = inlineTablePattern.exec(rawValue)) !== null) {
        const obj: Record<string, string> = {};
        const pairPattern = /(\w+)\s*=\s*["']([^"']*)["']/g;
        let m;
        while ((m = pairPattern.exec(itMatch[1])) !== null) {
          obj[m[1]] = m[2];
        }
        if (Object.keys(obj).length > 0) items.push(obj);
      }
      if (items.length === 0) {
        // Plain string array
        const strPattern = /["']([^"']*)["']/g;
        let m;
        while ((m = strPattern.exec(rawValue)) !== null) {
          items.push(m[1]);
        }
      }
      setNested(result, currentTable, key, items);
    } else if (rawValue.startsWith('{')) {
      // Inline table
      const obj: Record<string, string> = {};
      const pairPattern = /(\w+)\s*=\s*["']([^"']*)["']/g;
      let m;
      while ((m = pairPattern.exec(rawValue)) !== null) {
        obj[m[1]] = m[2];
      }
      setNested(result, currentTable, key, obj);
    } else if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const quote = rawValue[0];
      const endIdx = rawValue.indexOf(quote, 1);
      if (endIdx > 0) {
        setNested(result, currentTable, key, rawValue.slice(1, endIdx));
      }
    } else if (rawValue === 'true' || rawValue === 'false') {
      setNested(result, currentTable, key, rawValue === 'true');
    } else if (/^\d+$/.test(rawValue)) {
      setNested(result, currentTable, key, parseInt(rawValue, 10));
    }
  }

  return result;
}

function extractPyDepName(dep: string): string {
  return dep.split(/[>=<!~[;@ ]/)[0].trim().toLowerCase();
}

function parseRequirementsTxt(content: string): string[] {
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('git+'))
    .map(line => extractPyDepName(line))
    .filter(name => name.length > 0);
}

// ---------------------------------

interface PackageInfo {
  location: string;
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function scanMonorepoPackages(rootDir: string): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];
  
  // Check common monorepo locations
  const locations = ['apps', 'packages', 'libs', 'services', 'tools'];
  
  for (const location of locations) {
    const locationPath = join(rootDir, location);
    if (!(await fileExists(locationPath))) continue;
    
    try {
      const entries = await readdir(locationPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const pkgPath = join(locationPath, entry.name, 'package.json');
        if (await fileExists(pkgPath)) {
          const pkg = await readJSON<any>(pkgPath);
          packages.push({
            location: `${location}/${entry.name}`,
            name: pkg.name || entry.name,
            dependencies: pkg.dependencies,
            devDependencies: pkg.devDependencies,
            scripts: pkg.scripts
          });
        }
      }
    } catch (error) {
      // Skip if can't read directory
    }
  }
  
  return packages;
}

function aggregateDependencies(packages: PackageInfo[]): Record<string, string> {
  const allDeps: Record<string, string> = {};
  
  for (const pkg of packages) {
    Object.assign(allDeps, pkg.dependencies || {});
    Object.assign(allDeps, pkg.devDependencies || {});
  }
  
  return allDeps;
}

async function detectDockerConfig(rootDir: string): Promise<string[]> {
  const configs: string[] = [];
  
  if (await fileExists(join(rootDir, 'Dockerfile'))) configs.push('Dockerfile');
  if (await fileExists(join(rootDir, 'docker-compose.yml'))) configs.push('Docker Compose');
  if (await fileExists(join(rootDir, '.dockerignore'))) configs.push('Docker optimized');
  
  return configs;
}

async function detectEnvFiles(rootDir: string): Promise<string[]> {
  const envFiles: string[] = [];
  
  const patterns = ['.env', '.env.local', '.env.development', '.env.production', '.env.example', '.env.template'];
  
  for (const pattern of patterns) {
    if (await fileExists(join(rootDir, pattern))) {
      envFiles.push(pattern);
    }
  }
  
  return envFiles;
}

async function analyzeGitConfig(rootDir: string): Promise<any> {
  const gitConfig: any = {};
  
  if (await fileExists(join(rootDir, '.git'))) {
    gitConfig.isGitRepo = true;
    
    // Check for common git hooks
    const hooksDir = join(rootDir, '.git/hooks');
    if (await fileExists(hooksDir)) {
      gitConfig.hasHooks = true;
    }
  }
  
  // Check for GitHub-specific files
  if (await fileExists(join(rootDir, '.github'))) {
    gitConfig.github = true;
    
    if (await fileExists(join(rootDir, '.github/workflows'))) {
      gitConfig.githubActions = true;
    }
    
    if (await fileExists(join(rootDir, '.github/CODEOWNERS'))) {
      gitConfig.hasCodeowners = true;
    }
  }
  
  return gitConfig;
}

export async function inferProjectMetadata(rootDir: string): Promise<Project> {
  const packageJsonPath = join(rootDir, 'package.json');
  const hasPackageJson = await fileExists(packageJsonPath);

  let projectData: any = {};

  if (hasPackageJson) {
    projectData = await readJSON(packageJsonPath);
  }

  let name = projectData.name || '';
  let description = projectData.description || '';
  let projectVersion = projectData.version;
  let repository = projectData.repository?.url || projectData.repository;
  let license = projectData.license;
  let homepage = projectData.homepage;

  // Detect team info from package.json
  const team: any[] = [];
  if (projectData.author) {
    if (typeof projectData.author === 'string') {
      team.push({ name: projectData.author });
    } else {
      team.push(projectData.author);
    }
  }
  if (projectData.contributors) {
    team.push(...projectData.contributors);
  }

  // Try pyproject.toml for Python projects
  const pyprojectPath = join(rootDir, 'pyproject.toml');
  if (await fileExists(pyprojectPath)) {
    try {
      const pyContent = await readFile(pyprojectPath, 'utf-8');
      const pyproject = parsePyprojectToml(pyContent);
      const proj = pyproject?.project || {};

      if (!name && proj.name) name = proj.name;
      if (!description && proj.description) description = proj.description;
      if (!projectVersion && proj.version) projectVersion = proj.version;

      // License from pyproject.toml
      if (!license) {
        if (typeof proj.license === 'string') license = proj.license;
        else if (proj.license?.text) license = proj.license.text;
      }

      // Authors from pyproject.toml
      if (team.length === 0 && Array.isArray(proj.authors)) {
        for (const author of proj.authors) {
          if (typeof author === 'object' && author.name) {
            team.push({ name: author.name, email: author.email });
          }
        }
      }

      // Python version as runtime info
      if (proj['requires-python']) {
        // Store for later use but don't set here — stack handles runtime
      }
    } catch {}
  }

  // Try Cargo.toml for Rust projects
  const cargoProjectPath = join(rootDir, 'Cargo.toml');
  if (await fileExists(cargoProjectPath)) {
    try {
      const cargoContent = await readFile(cargoProjectPath, 'utf-8');
      const cargo = parsePyprojectToml(cargoContent);
      const pkg = cargo?.package || {};

      if (!name && pkg.name) name = pkg.name;
      if (!description && pkg.description) description = pkg.description;
      if (!projectVersion && pkg.version) projectVersion = pkg.version;
      if (!license && pkg.license) license = pkg.license;
      if (!repository && pkg.repository) repository = pkg.repository;
      if (!homepage && pkg.homepage) homepage = pkg.homepage;

      if (team.length === 0 && Array.isArray(pkg.authors)) {
        for (const author of pkg.authors) {
          if (typeof author === 'string') {
            team.push({ name: author.replace(/<.*>/, '').trim() });
          }
        }
      }
    } catch {}
  }

  // Try go.mod for Go projects (module name only)
  const goModProjectPath = join(rootDir, 'go.mod');
  if (await fileExists(goModProjectPath) && !name) {
    try {
      const goModContent = await readFile(goModProjectPath, 'utf-8');
      const moduleMatch = goModContent.match(/^module\s+(\S+)/m);
      if (moduleMatch) {
        // Use the last segment of the module path as name
        const parts = moduleMatch[1].split('/');
        name = parts[parts.length - 1];
      }
    } catch {}
  }

  // Fall back to directory name for name
  if (!name) name = basename(rootDir);

  // Fall back to README for description
  if (!description) {
    const readmePath = join(rootDir, 'README.md');
    if (await fileExists(readmePath)) {
      try {
        const readme = await readFile(readmePath, 'utf-8');
        const lines = readme.split('\n').filter(l => l.trim());
        const firstParagraph = lines.find(l => !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('---') && l.length > 20);
        if (firstParagraph) {
          description = firstParagraph.slice(0, 200);
        }
      } catch {}
    }
  }

  if (!description) description = 'No description provided';

  return {
    $schema: `${SCHEMA_URL}/project.schema.json`,
    version: PRELUDE_VERSION,
    name,
    description,
    projectVersion,
    createdAt: getCurrentTimestamp(),
    updatedAt: getCurrentTimestamp(),
    repository,
    license,
    homepage,
    team: team.length > 0 ? team : undefined
  };
}

export async function inferStack(rootDir: string): Promise<Stack> {
  // --- MODIFIED INITIALIZATION ---
  const stack: Partial<Stack> = {
    $schema: `${SCHEMA_URL}/stack.schema.json`,
    version: PRELUDE_VERSION,
    // We must set language to a default, as it's required in the schema
    language: 'unknown' 
  };
  
  // Check for Node.js project
  const packageJsonPath = join(rootDir, 'package.json');
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJSON<any>(packageJsonPath);
    
    stack.language = 'TypeScript/JavaScript';
    
    // Detect runtime
    if (pkg.engines?.node) {
      stack.runtime = `Node.js ${pkg.engines.node}`;
    } else if (await fileExists(join(rootDir, '.nvmrc'))) {
      const nvmrc = await readFile(join(rootDir, '.nvmrc'), 'utf-8');
      stack.runtime = `Node.js ${nvmrc.trim()}`;
    }
    
    // Detect package manager
    if (await fileExists(join(rootDir, 'pnpm-lock.yaml')) || await fileExists(join(rootDir, 'pnpm-workspace.yaml'))) {
      stack.packageManager = 'pnpm';
    } else if (await fileExists(join(rootDir, 'yarn.lock'))) {
      stack.packageManager = 'yarn';
    } else if (await fileExists(join(rootDir, 'bun.lockb'))) {
      stack.packageManager = 'bun';
    } else if (await fileExists(join(rootDir, 'package-lock.json'))) {
      stack.packageManager = 'npm';
    }
    
    // Check if it's a monorepo
    const isMonorepo = await fileExists(join(rootDir, 'pnpm-workspace.yaml')) ||
                       await fileExists(join(rootDir, 'turbo.json')) ||
                       await fileExists(join(rootDir, 'lerna.json')) ||
                       await fileExists(join(rootDir, 'nx.json')) ||
                       pkg.workspaces;
    
    // --- THIS IS THE CRITICAL FIX ---
    let allDeps: Record<string, string>;

    if (isMonorepo) {
      // Scan all packages in monorepo
      const packages = await scanMonorepoPackages(rootDir);
      allDeps = aggregateDependencies([{ ...pkg, location: 'root', name: 'root' }, ...packages]);
    } else {
      allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    }
    // ---------------------------------
    
    stack.dependencies = pkg.dependencies || {};
    stack.devDependencies = pkg.devDependencies || {};
    
    // === FRAMEWORKS ===
    const frameworks: string[] = [];
    
    // Frontend Frameworks
    if (allDeps['next']) frameworks.push('Next.js');
    if (allDeps['react']) frameworks.push('React');
    if (allDeps['vue']) frameworks.push('Vue');
    if (allDeps['@angular/core']) frameworks.push('Angular');
    if (allDeps['svelte']) frameworks.push('Svelte');
    if (allDeps['solid-js']) frameworks.push('Solid');
    if (allDeps['qwik']) frameworks.push('Qwik');
    if (allDeps['astro']) frameworks.push('Astro');
    if (allDeps['remix']) frameworks.push('Remix');
    if (allDeps['nuxt']) frameworks.push('Nuxt');
    if (allDeps['gatsby']) frameworks.push('Gatsby');
    if (allDeps['preact']) frameworks.push('Preact');
    
    // Backend Frameworks
    if (allDeps['express']) frameworks.push('Express');
    if (allDeps['fastify']) frameworks.push('Fastify');
    if (allDeps['@nestjs/core']) frameworks.push('NestJS');
    if (allDeps['hono']) frameworks.push('Hono');
    if (allDeps['koa']) frameworks.push('Koa');
    if (allDeps['@hapi/hapi']) frameworks.push('Hapi');
    if (allDeps['apollo-server']) frameworks.push('Apollo Server');
    if (allDeps['trpc']) frameworks.push('tRPC');
    
    // Meta-frameworks
    if (allDeps['@redwoodjs/core']) frameworks.push('RedwoodJS');
    if (allDeps['blitz']) frameworks.push('Blitz.js');
    
    stack.frameworks = frameworks;
    stack.framework = frameworks[0];
    
    // === BUILD TOOLS ===
    const buildTools: string[] = [];
    if (allDeps['vite']) buildTools.push('Vite');
    if (allDeps['webpack']) buildTools.push('Webpack');
    if (allDeps['turbopack']) buildTools.push('Turbopack');
    if (allDeps['esbuild']) buildTools.push('esbuild');
    if (allDeps['tsup']) buildTools.push('tsup');
    if (allDeps['rollup']) buildTools.push('Rollup');
    if (allDeps['parcel']) buildTools.push('Parcel');
    if (allDeps['swc']) buildTools.push('SWC');
    if (allDeps['turbo'] || await fileExists(join(rootDir, 'turbo.json'))) buildTools.push('Turborepo');
    if (allDeps['nx'] || await fileExists(join(rootDir, 'nx.json'))) buildTools.push('Nx');
    if (allDeps['lerna'] || await fileExists(join(rootDir, 'lerna.json'))) buildTools.push('Lerna');
    
    stack.buildTools = buildTools;
    
    // === TESTING FRAMEWORKS ===
    const testingFrameworks: string[] = [];
    if (allDeps['vitest']) testingFrameworks.push('Vitest');
    if (allDeps['jest']) testingFrameworks.push('Jest');
    if (allDeps['mocha']) testingFrameworks.push('Mocha');
    if (allDeps['ava']) testingFrameworks.push('AVA');
    if (allDeps['@playwright/test']) testingFrameworks.push('Playwright');
    if (allDeps['cypress']) testingFrameworks.push('Cypress');
    if (allDeps['@testing-library/react']) testingFrameworks.push('React Testing Library');
    if (allDeps['@testing-library/vue']) testingFrameworks.push('Vue Testing Library');
    if (allDeps['puppeteer']) testingFrameworks.push('Puppeteer');
    if (allDeps['selenium-webdriver']) testingFrameworks.push('Selenium');
    
    stack.testingFrameworks = testingFrameworks;
    
    // === STYLING ===
    const styling: string[] = [];
    if (allDeps['tailwindcss'] || await fileExists(join(rootDir, 'tailwind.config.js')) || await fileExists(join(rootDir, 'tailwind.config.ts'))) {
      styling.push('Tailwind CSS');
    }
    if (allDeps['styled-components']) styling.push('Styled Components');
    if (allDeps['@emotion/react']) styling.push('Emotion');
    if (allDeps['@emotion/styled']) styling.push('Emotion');
    if (allDeps['sass'] || allDeps['node-sass']) styling.push('Sass/SCSS');
    if (allDeps['less']) styling.push('Less');
    if (allDeps['postcss']) styling.push('PostCSS');
    if (allDeps['styled-jsx']) styling.push('Styled JSX');
    if (allDeps['@vanilla-extract/css']) styling.push('Vanilla Extract');
    if (allDeps['@stitches/react']) styling.push('Stitches');
    if (allDeps['@mui/material']) styling.push('Material-UI');
    if (allDeps['@chakra-ui/react']) styling.push('Chakra UI');
    if (allDeps['@mantine/core']) styling.push('Mantine');
    if (allDeps['antd']) styling.push('Ant Design');
    if (allDeps['@radix-ui/react-primitive']) styling.push('Radix UI');
    if (allDeps['@headlessui/react']) styling.push('Headless UI');
    if (allDeps['daisyui']) styling.push('DaisyUI');
    if (allDeps['shadcn-ui'] || allDeps['@shadcn/ui']) styling.push('shadcn/ui');
    
    stack.styling = styling;
    
    // === ORM/DATABASE ===
    if (allDeps['drizzle-orm']) stack.orm = 'Drizzle ORM';
    else if (allDeps['prisma']) stack.orm = 'Prisma';
    else if (allDeps['typeorm']) stack.orm = 'TypeORM';
    else if (allDeps['sequelize']) stack.orm = 'Sequelize';
    else if (allDeps['mongoose']) stack.orm = 'Mongoose';
    else if (allDeps['kysely']) stack.orm = 'Kysely';
    else if (allDeps['knex']) stack.orm = 'Knex.js';
    else if (allDeps['mikro-orm']) stack.orm = 'MikroORM';
    
    // Database Clients & Services
    const databases: string[] = [];
    if (allDeps['@supabase/supabase-js']) databases.push('Supabase');
    if (allDeps['firebase'] || allDeps['firebase-admin']) databases.push('Firebase');
    if (allDeps['pg'] || allDeps['postgres']) databases.push('PostgreSQL');
    if (allDeps['mysql'] || allDeps['mysql2']) databases.push('MySQL');
    if (allDeps['sqlite3'] || allDeps['better-sqlite3']) databases.push('SQLite');
    if (allDeps['mongodb']) databases.push('MongoDB');
    if (allDeps['redis'] || allDeps['ioredis']) databases.push('Redis');
    if (allDeps['@planetscale/database']) databases.push('PlanetScale');
    if (allDeps['@vercel/postgres']) databases.push('Vercel Postgres');
    if (allDeps['@neondatabase/serverless']) databases.push('Neon');
    if (allDeps['@upstash/redis']) databases.push('Upstash Redis');
    
    if (databases.length > 0) {
      stack.database = databases.join(', ');
    }
    
    // === STATE MANAGEMENT ===
    const stateManagement: string[] = [];
    if (allDeps['redux']) stateManagement.push('Redux');
    if (allDeps['@reduxjs/toolkit']) stateManagement.push('Redux Toolkit');
    if (allDeps['zustand']) stateManagement.push('Zustand');
    if (allDeps['jotai']) stateManagement.push('Jotai');
    if (allDeps['recoil']) stateManagement.push('Recoil');
    if (allDeps['mobx']) stateManagement.push('MobX');
    if (allDeps['valtio']) stateManagement.push('Valtio');
    if (allDeps['xstate']) stateManagement.push('XState');
    if (allDeps['@tanstack/react-query']) stateManagement.push('TanStack Query');
    if (allDeps['swr']) stateManagement.push('SWR');
    
    if (stateManagement.length > 0) {
      stack.stateManagement = stateManagement.join(', ');
    }
    
    // === AUTHENTICATION ===
    const auth: string[] = [];
    if (allDeps['next-auth']) auth.push('NextAuth.js');
    if (allDeps['@clerk/nextjs']) auth.push('Clerk');
    if (allDeps['@auth0/nextjs']) auth.push('Auth0');
    if (allDeps['@supabase/auth-helpers-nextjs']) auth.push('Supabase Auth');
    if (allDeps['passport']) auth.push('Passport.js');
    if (allDeps['lucia']) auth.push('Lucia');
    if (allDeps['better-auth']) auth.push('Better Auth');
    
    // === API/DATA FETCHING ===
    const apiTools: string[] = [];
    if (allDeps['@trpc/server']) apiTools.push('tRPC');
    if (allDeps['graphql']) apiTools.push('GraphQL');
    if (allDeps['@apollo/client']) apiTools.push('Apollo Client');
    if (allDeps['axios']) apiTools.push('Axios');
    if (allDeps['ky']) apiTools.push('Ky');
    if (allDeps['@tanstack/react-query']) apiTools.push('TanStack Query');
    if (allDeps['swr']) apiTools.push('SWR');
    
    // === VALIDATION ===
    const validation: string[] = [];
    if (allDeps['zod']) validation.push('Zod');
    if (allDeps['yup']) validation.push('Yup');
    if (allDeps['joi']) validation.push('Joi');
    if (allDeps['ajv']) validation.push('AJV');
    if (allDeps['valibot']) validation.push('Valibot');
    if (allDeps['superstruct']) validation.push('Superstruct');
    
    // === FORMS ===
    const forms: string[] = [];
    if (allDeps['react-hook-form']) forms.push('React Hook Form');
    if (allDeps['formik']) forms.push('Formik');
    if (allDeps['@tanstack/react-form']) forms.push('TanStack Form');
    if (allDeps['@conform-to/react']) forms.push('Conform');
    
    // === ANIMATION ===
    const animation: string[] = [];
    if (allDeps['framer-motion']) animation.push('Framer Motion');
    if (allDeps['@react-spring/web']) animation.push('React Spring');
    if (allDeps['gsap']) animation.push('GSAP');
    if (allDeps['anime']) animation.push('Anime.js');
    
    // === CI/CD ===
    const cicd: string[] = [];
    if (await fileExists(join(rootDir, '.github/workflows'))) cicd.push('GitHub Actions');
    if (await fileExists(join(rootDir, '.gitlab-ci.yml'))) cicd.push('GitLab CI');
    if (await fileExists(join(rootDir, '.circleci'))) cicd.push('CircleCI');
    if (await fileExists(join(rootDir, 'jenkins'))) cicd.push('Jenkins');
    if (await fileExists(join(rootDir, '.travis.yml'))) cicd.push('Travis CI');
    if (await fileExists(join(rootDir, 'azure-pipelines.yml'))) cicd.push('Azure Pipelines');
    
    stack.cicd = cicd;
    
    // === DEPLOYMENT ===
    if (await fileExists(join(rootDir, 'vercel.json'))) stack.deployment = 'Vercel';
    else if (await fileExists(join(rootDir, 'netlify.toml'))) stack.deployment = 'Netlify';
    else if (await fileExists(join(rootDir, 'Dockerfile'))) stack.deployment = 'Docker';
    else if (await fileExists(join(rootDir, 'railway.json'))) stack.deployment = 'Railway';
    else if (await fileExists(join(rootDir, 'fly.toml'))) stack.deployment = 'Fly.io';
    else if (await fileExists(join(rootDir, 'render.yaml'))) stack.deployment = 'Render';
    else if (allDeps['@aws-sdk/client-s3']) stack.deployment = 'AWS'; // This now works
  }
  
  // Check for Python project
  const requirementsPath = join(rootDir, 'requirements.txt');
  const pyprojectPath = join(rootDir, 'pyproject.toml');

  if (await fileExists(pyprojectPath) || await fileExists(requirementsPath)) {
    stack.language = 'Python';

    const allPyDeps: Set<string> = new Set();

    // Parse pyproject.toml
    if (await fileExists(pyprojectPath)) {
      try {
        const pyContent = await readFile(pyprojectPath, 'utf-8');
        const pyproject = parsePyprojectToml(pyContent);

        // Package manager detection
        const buildBackend = pyproject?.['build-system']?.['build-backend'] || '';
        if (buildBackend.includes('poetry')) {
          stack.packageManager = 'poetry';
        } else if (await fileExists(join(rootDir, 'uv.lock'))) {
          stack.packageManager = 'uv' as any;
        } else if (await fileExists(join(rootDir, 'poetry.lock'))) {
          stack.packageManager = 'poetry';
        } else if (await fileExists(join(rootDir, 'Pipfile')) || await fileExists(join(rootDir, 'Pipfile.lock'))) {
          stack.packageManager = 'pipenv' as any;
        } else {
          stack.packageManager = 'pip';
        }

        // Python version
        const requiresPython = pyproject?.project?.['requires-python'];
        if (requiresPython) {
          stack.runtime = `Python ${requiresPython}`;
        }

        // Collect deps from [project.dependencies]
        const projDeps: string[] = pyproject?.project?.dependencies || [];
        const depsRecord: Record<string, string> = {};
        for (const dep of projDeps) {
          const depName = extractPyDepName(dep);
          const version = dep.slice(depName.length).replace(/^\[.*?\]/, '').trim() || '*';
          depsRecord[depName] = version;
          allPyDeps.add(depName);
        }
        if (Object.keys(depsRecord).length > 0) {
          stack.dependencies = depsRecord;
        }

        // Collect dev/optional deps from [project.optional-dependencies]
        const optDeps = pyproject?.project?.['optional-dependencies'] || {};
        const devDepsRecord: Record<string, string> = {};
        for (const [, groupDeps] of Object.entries(optDeps)) {
          if (Array.isArray(groupDeps)) {
            for (const dep of groupDeps) {
              if (typeof dep === 'string') {
                const depName = extractPyDepName(dep);
                const version = dep.slice(depName.length).replace(/^\[.*?\]/, '').trim() || '*';
                devDepsRecord[depName] = version;
                allPyDeps.add(depName);
              }
            }
          }
        }
        if (Object.keys(devDepsRecord).length > 0) {
          stack.devDependencies = devDepsRecord;
        }

        // Also check Poetry-style deps under [tool.poetry.dependencies]
        const poetryDeps = pyproject?.tool?.poetry?.dependencies;
        if (poetryDeps && typeof poetryDeps === 'object') {
          for (const depName of Object.keys(poetryDeps)) {
            if (depName !== 'python') allPyDeps.add(depName.toLowerCase());
          }
        }
      } catch {}
    }

    // Parse requirements.txt as fallback/supplement
    if (await fileExists(requirementsPath)) {
      try {
        const reqContent = await readFile(requirementsPath, 'utf-8');
        const reqDeps = parseRequirementsTxt(reqContent);
        for (const dep of reqDeps) allPyDeps.add(dep);

        if (!stack.dependencies || Object.keys(stack.dependencies).length === 0) {
          const depsRecord: Record<string, string> = {};
          for (const dep of reqDeps) depsRecord[dep] = '*';
          stack.dependencies = depsRecord;
          stack.packageManager = stack.packageManager || 'pip';
        }
      } catch {}
    }

    // === FRAMEWORKS ===
    const pyFrameworks: string[] = [];
    // Web frameworks
    if (allPyDeps.has('django')) pyFrameworks.push('Django');
    if (allPyDeps.has('flask')) pyFrameworks.push('Flask');
    if (allPyDeps.has('fastapi')) pyFrameworks.push('FastAPI');
    if (allPyDeps.has('starlette')) pyFrameworks.push('Starlette');
    if (allPyDeps.has('tornado')) pyFrameworks.push('Tornado');
    if (allPyDeps.has('pyramid')) pyFrameworks.push('Pyramid');
    if (allPyDeps.has('sanic')) pyFrameworks.push('Sanic');
    if (allPyDeps.has('falcon')) pyFrameworks.push('Falcon');
    if (allPyDeps.has('litestar')) pyFrameworks.push('Litestar');
    // CLI frameworks
    if (allPyDeps.has('typer')) pyFrameworks.push('Typer');
    if (allPyDeps.has('click')) pyFrameworks.push('Click');
    // ML/AI frameworks
    if (allPyDeps.has('langchain')) pyFrameworks.push('LangChain');
    if (allPyDeps.has('transformers')) pyFrameworks.push('Hugging Face Transformers');
    if (allPyDeps.has('torch') || allPyDeps.has('pytorch')) pyFrameworks.push('PyTorch');
    if (allPyDeps.has('tensorflow')) pyFrameworks.push('TensorFlow');
    if (allPyDeps.has('scikit-learn') || allPyDeps.has('sklearn')) pyFrameworks.push('scikit-learn');
    // Data
    if (allPyDeps.has('pandas')) pyFrameworks.push('pandas');
    if (allPyDeps.has('numpy')) pyFrameworks.push('NumPy');

    if (pyFrameworks.length > 0) {
      stack.frameworks = pyFrameworks;
      stack.framework = pyFrameworks[0];
    }

    // === TESTING ===
    const pyTesting: string[] = [];
    if (allPyDeps.has('pytest')) pyTesting.push('pytest');
    if (allPyDeps.has('pytest-cov')) pyTesting.push('pytest-cov');
    if (allPyDeps.has('hypothesis')) pyTesting.push('Hypothesis');
    if (allPyDeps.has('tox')) pyTesting.push('tox');
    if (allPyDeps.has('nox')) pyTesting.push('nox');
    if (allPyDeps.has('coverage')) pyTesting.push('coverage');

    if (pyTesting.length > 0) {
      stack.testingFrameworks = pyTesting;
    }

    // === BUILD TOOLS ===
    const pyBuildTools: string[] = [];
    if (allPyDeps.has('setuptools')) pyBuildTools.push('setuptools');
    if (allPyDeps.has('wheel')) pyBuildTools.push('wheel');
    if (allPyDeps.has('cython')) pyBuildTools.push('Cython');
    if (allPyDeps.has('maturin')) pyBuildTools.push('Maturin');

    if (pyBuildTools.length > 0) {
      stack.buildTools = pyBuildTools;
    }

    // === ORM/DATABASE ===
    if (allPyDeps.has('sqlalchemy')) stack.orm = 'SQLAlchemy';
    else if (allPyDeps.has('tortoise-orm')) stack.orm = 'Tortoise ORM';
    else if (allPyDeps.has('peewee')) stack.orm = 'Peewee';
    else if (allPyDeps.has('mongoengine')) stack.orm = 'MongoEngine';
    else if (allPyDeps.has('django')) stack.orm = 'Django ORM';

    const pyDatabases: string[] = [];
    if (allPyDeps.has('psycopg2') || allPyDeps.has('psycopg2-binary') || allPyDeps.has('psycopg') || allPyDeps.has('asyncpg')) pyDatabases.push('PostgreSQL');
    if (allPyDeps.has('pymongo') || allPyDeps.has('motor')) pyDatabases.push('MongoDB');
    if (allPyDeps.has('redis') || allPyDeps.has('aioredis')) pyDatabases.push('Redis');
    if (allPyDeps.has('pymysql') || allPyDeps.has('mysqlclient')) pyDatabases.push('MySQL');
    if (allPyDeps.has('aiosqlite')) pyDatabases.push('SQLite');
    if (allPyDeps.has('supabase')) pyDatabases.push('Supabase');

    if (pyDatabases.length > 0) {
      stack.database = pyDatabases.join(', ');
    }

    // === DEPLOYMENT ===
    if (!stack.deployment) {
      if (await fileExists(join(rootDir, 'Dockerfile'))) stack.deployment = 'Docker';
      else if (await fileExists(join(rootDir, 'Procfile'))) stack.deployment = 'Heroku';
      else if (await fileExists(join(rootDir, 'fly.toml'))) stack.deployment = 'Fly.io';
      else if (await fileExists(join(rootDir, 'render.yaml'))) stack.deployment = 'Render';
    }

    // === CI/CD ===
    if (!stack.cicd || stack.cicd.length === 0) {
      const cicd: string[] = [];
      if (await fileExists(join(rootDir, '.github/workflows'))) cicd.push('GitHub Actions');
      if (await fileExists(join(rootDir, '.gitlab-ci.yml'))) cicd.push('GitLab CI');
      if (await fileExists(join(rootDir, '.circleci'))) cicd.push('CircleCI');
      if (await fileExists(join(rootDir, 'tox.ini'))) cicd.push('tox');
      stack.cicd = cicd;
    }
  }
  
  // Check for Rust project
  const cargoPath = join(rootDir, 'Cargo.toml');
  if (await fileExists(cargoPath)) {
    stack.language = 'Rust';
    stack.packageManager = 'cargo';

    try {
      const cargoContent = await readFile(cargoPath, 'utf-8');
      const cargo = parsePyprojectToml(cargoContent); // TOML parser works for Cargo.toml too

      // Rust edition as runtime
      const edition = cargo?.package?.edition;
      if (edition) {
        stack.runtime = `Rust Edition ${edition}`;
      }

      // Collect all deps
      const cargoDeps = cargo?.dependencies || {};
      const cargoDevDeps = cargo?.['dev-dependencies'] || {};
      const cargoBuildDeps = cargo?.['build-dependencies'] || {};
      const allCrateDeps = new Set([
        ...Object.keys(cargoDeps).map((s: string) => s.toLowerCase()),
        ...Object.keys(cargoDevDeps).map((s: string) => s.toLowerCase()),
        ...Object.keys(cargoBuildDeps).map((s: string) => s.toLowerCase()),
      ]);

      // Store deps
      const rustDepsRecord: Record<string, string> = {};
      for (const [name, spec] of Object.entries(cargoDeps)) {
        rustDepsRecord[name] = typeof spec === 'string' ? spec : '*';
      }
      if (Object.keys(rustDepsRecord).length > 0) stack.dependencies = rustDepsRecord;

      const rustDevDepsRecord: Record<string, string> = {};
      for (const [name, spec] of Object.entries(cargoDevDeps)) {
        rustDevDepsRecord[name] = typeof spec === 'string' ? spec : '*';
      }
      if (Object.keys(rustDevDepsRecord).length > 0) stack.devDependencies = rustDevDepsRecord;

      // === FRAMEWORKS ===
      const rustFrameworks: string[] = [];
      // Web frameworks
      if (allCrateDeps.has('actix-web')) rustFrameworks.push('Actix Web');
      if (allCrateDeps.has('axum')) rustFrameworks.push('Axum');
      if (allCrateDeps.has('rocket')) rustFrameworks.push('Rocket');
      if (allCrateDeps.has('warp')) rustFrameworks.push('Warp');
      if (allCrateDeps.has('tide')) rustFrameworks.push('Tide');
      // Async runtime
      if (allCrateDeps.has('tokio')) rustFrameworks.push('Tokio');
      if (allCrateDeps.has('async-std')) rustFrameworks.push('async-std');
      // CLI
      if (allCrateDeps.has('clap')) rustFrameworks.push('Clap');
      if (allCrateDeps.has('structopt')) rustFrameworks.push('StructOpt');
      // Serialization
      if (allCrateDeps.has('serde')) rustFrameworks.push('Serde');
      // GUI
      if (allCrateDeps.has('tauri')) rustFrameworks.push('Tauri');
      if (allCrateDeps.has('egui')) rustFrameworks.push('egui');
      if (allCrateDeps.has('iced')) rustFrameworks.push('Iced');

      if (rustFrameworks.length > 0) {
        stack.frameworks = rustFrameworks;
        stack.framework = rustFrameworks[0];
      }

      // === TESTING ===
      const rustTesting: string[] = [];
      if (allCrateDeps.has('criterion')) rustTesting.push('Criterion (benchmarks)');
      if (allCrateDeps.has('proptest')) rustTesting.push('proptest');
      if (allCrateDeps.has('quickcheck')) rustTesting.push('quickcheck');
      if (allCrateDeps.has('mockall')) rustTesting.push('mockall');
      if (allCrateDeps.has('rstest')) rustTesting.push('rstest');
      // Rust has built-in testing
      rustTesting.unshift('cargo test (built-in)');
      stack.testingFrameworks = rustTesting;

      // === ORM/DATABASE ===
      if (allCrateDeps.has('diesel')) stack.orm = 'Diesel';
      else if (allCrateDeps.has('sea-orm') || allCrateDeps.has('sea_orm')) stack.orm = 'SeaORM';
      else if (allCrateDeps.has('sqlx')) stack.orm = 'SQLx';

      const rustDatabases: string[] = [];
      if (allCrateDeps.has('tokio-postgres') || allCrateDeps.has('sqlx') || allCrateDeps.has('diesel')) rustDatabases.push('PostgreSQL');
      if (allCrateDeps.has('mongodb')) rustDatabases.push('MongoDB');
      if (allCrateDeps.has('redis')) rustDatabases.push('Redis');
      if (allCrateDeps.has('rusqlite')) rustDatabases.push('SQLite');
      if (rustDatabases.length > 0) stack.database = rustDatabases.join(', ');

      // === BUILD TOOLS ===
      const rustBuildTools: string[] = [];
      if (allCrateDeps.has('maturin')) rustBuildTools.push('Maturin');
      if (allCrateDeps.has('wasm-bindgen')) rustBuildTools.push('wasm-bindgen');
      if (allCrateDeps.has('napi') || allCrateDeps.has('napi-derive')) rustBuildTools.push('napi-rs');
      if (rustBuildTools.length > 0) stack.buildTools = rustBuildTools;

      // === DEPLOYMENT ===
      if (!stack.deployment) {
        if (await fileExists(join(rootDir, 'Dockerfile'))) stack.deployment = 'Docker';
        else if (await fileExists(join(rootDir, 'fly.toml'))) stack.deployment = 'Fly.io';
        else if (await fileExists(join(rootDir, 'shuttle.toml')) || allCrateDeps.has('shuttle-runtime')) stack.deployment = 'Shuttle';
      }

      // === CI/CD ===
      if (!stack.cicd || stack.cicd.length === 0) {
        const cicd: string[] = [];
        if (await fileExists(join(rootDir, '.github/workflows'))) cicd.push('GitHub Actions');
        if (await fileExists(join(rootDir, '.gitlab-ci.yml'))) cicd.push('GitLab CI');
        stack.cicd = cicd;
      }
    } catch {}
  }

  // Check for Go project
  const goModPath = join(rootDir, 'go.mod');
  if (await fileExists(goModPath)) {
    stack.language = 'Go';
    stack.packageManager = 'go';

    try {
      const goModContent = await readFile(goModPath, 'utf-8');

      // Parse Go version
      const goVersionMatch = goModContent.match(/^go\s+(\S+)/m);
      if (goVersionMatch) {
        stack.runtime = `Go ${goVersionMatch[1]}`;
      }

      // Parse module path
      const moduleMatch = goModContent.match(/^module\s+(\S+)/m);
      const modulePath = moduleMatch?.[1] || '';

      // Parse require block
      const allGoMods = new Set<string>();
      const depsRecord: Record<string, string> = {};

      // Single-line requires: require github.com/foo/bar v1.2.3
      const singleReqs = goModContent.matchAll(/^require\s+(\S+)\s+(\S+)/gm);
      for (const m of singleReqs) {
        const modName = m[1].toLowerCase();
        allGoMods.add(modName);
        depsRecord[m[1]] = m[2];
      }

      // Block requires
      const requireBlocks = goModContent.matchAll(/require\s*\(([\s\S]*?)\)/g);
      for (const block of requireBlocks) {
        const lines = block[1].split('\n');
        for (const line of lines) {
          const depMatch = line.trim().match(/^(\S+)\s+(\S+)/);
          if (depMatch && !depMatch[1].startsWith('//')) {
            allGoMods.add(depMatch[1].toLowerCase());
            depsRecord[depMatch[1]] = depMatch[2];
          }
        }
      }

      if (Object.keys(depsRecord).length > 0) stack.dependencies = depsRecord;

      // Helper: check if any go module path contains a substring
      const hasGoMod = (name: string) => [...allGoMods].some(m => m.includes(name));

      // === FRAMEWORKS ===
      const goFrameworks: string[] = [];
      if (hasGoMod('gin-gonic/gin')) goFrameworks.push('Gin');
      if (hasGoMod('labstack/echo')) goFrameworks.push('Echo');
      if (hasGoMod('gofiber/fiber')) goFrameworks.push('Fiber');
      if (hasGoMod('go-chi/chi')) goFrameworks.push('Chi');
      if (hasGoMod('gorilla/mux')) goFrameworks.push('Gorilla Mux');
      if (hasGoMod('beego')) goFrameworks.push('Beego');
      if (hasGoMod('grpc')) goFrameworks.push('gRPC');
      // CLI
      if (hasGoMod('spf13/cobra')) goFrameworks.push('Cobra');
      if (hasGoMod('urfave/cli')) goFrameworks.push('urfave/cli');
      // Config
      if (hasGoMod('spf13/viper')) goFrameworks.push('Viper');

      if (goFrameworks.length > 0) {
        stack.frameworks = goFrameworks;
        stack.framework = goFrameworks[0];
      }

      // === TESTING ===
      const goTesting: string[] = ['go test (built-in)'];
      if (hasGoMod('stretchr/testify')) goTesting.push('Testify');
      if (hasGoMod('onsi/ginkgo')) goTesting.push('Ginkgo');
      if (hasGoMod('onsi/gomega')) goTesting.push('Gomega');
      stack.testingFrameworks = goTesting;

      // === ORM/DATABASE ===
      if (hasGoMod('gorm.io')) stack.orm = 'GORM';
      else if (hasGoMod('ent/ent')) stack.orm = 'Ent';
      else if (hasGoMod('sqlc')) stack.orm = 'sqlc';
      else if (hasGoMod('jmoiron/sqlx')) stack.orm = 'sqlx';

      const goDatabases: string[] = [];
      if (hasGoMod('lib/pq') || hasGoMod('jackc/pgx') || hasGoMod('pgx')) goDatabases.push('PostgreSQL');
      if (hasGoMod('go.mongodb.org') || hasGoMod('mongo-driver')) goDatabases.push('MongoDB');
      if (hasGoMod('go-redis/redis') || hasGoMod('redis/go-redis')) goDatabases.push('Redis');
      if (hasGoMod('mattn/go-sqlite3')) goDatabases.push('SQLite');
      if (hasGoMod('go-sql-driver/mysql')) goDatabases.push('MySQL');
      if (goDatabases.length > 0) stack.database = goDatabases.join(', ');

      // === DEPLOYMENT ===
      if (!stack.deployment) {
        if (await fileExists(join(rootDir, 'Dockerfile'))) stack.deployment = 'Docker';
        else if (await fileExists(join(rootDir, 'fly.toml'))) stack.deployment = 'Fly.io';
      }

      // === CI/CD ===
      if (!stack.cicd || stack.cicd.length === 0) {
        const cicd: string[] = [];
        if (await fileExists(join(rootDir, '.github/workflows'))) cicd.push('GitHub Actions');
        if (await fileExists(join(rootDir, '.gitlab-ci.yml'))) cicd.push('GitLab CI');
        stack.cicd = cicd;
      }
    } catch {}
  }
  
  return stack as Stack;
}

export async function inferArchitecture(rootDir: string): Promise<Architecture> {
  // --- MODIFIED INITIALIZATION ---
  const architecture: Partial<Architecture> = {
    $schema: `${SCHEMA_URL}/architecture.schema.json`,
    version: PRELUDE_VERSION,
    directories: []
  };
  
  // Get directory structure
  const dirs = await getDirectoryTree(rootDir, 3); // Increased depth to 3
  const relativeDirs = dirs.map(dir => relative(rootDir, dir));
  
  // Count files in each directory
  const dirInfo = await Promise.all(
    relativeDirs.map(async (dir) => {
      const fullPath = join(rootDir, dir);
      try {
        const files = await readdir(fullPath);
        
        // Determine purpose based on directory name
        let purpose = undefined;
        if (dir.includes('components')) purpose = 'UI components';
        else if (dir.includes('pages')) purpose = 'Route pages';
        else if (dir.includes('app')) purpose = 'Application code';
        else if (dir.includes('lib') || dir.includes('utils')) purpose = 'Utility functions';
        else if (dir.includes('hooks')) purpose = 'React hooks';
        else if (dir.includes('context')) purpose = 'React context';
        else if (dir.includes('store')) purpose = 'State management';
        else if (dir.includes('api')) purpose = 'API routes';
        else if (dir.includes('services')) purpose = 'Business logic';
        else if (dir.includes('db') || dir.includes('database')) purpose = 'Database layer';
        else if (dir.includes('schema')) purpose = 'Data schemas';
        else if (dir.includes('types')) purpose = 'TypeScript types';
        else if (dir.includes('config')) purpose = 'Configuration';
        else if (dir.includes('public')) purpose = 'Static assets';
        else if (dir.includes('styles')) purpose = 'Stylesheets';
        else if (dir.includes('tests') || dir.includes('__tests__')) purpose = 'Tests';
        
        return {
          path: dir,
          fileCount: files.length,
          purpose
        };
      } catch {
        return {
          path: dir,
          fileCount: 0
        };
      }
    })
  );
  
  architecture.directories = dirInfo.filter(d => d.fileCount > 0);
  
  // Infer project type
  const hasPages = relativeDirs.some(d => d.includes('pages') && !d.includes('api'));
  const hasApp = relativeDirs.some(d => d.match(/^apps?\//) || d === 'app');
  const hasSrc = relativeDirs.some(d => d === 'src');
  const hasLib = relativeDirs.some(d => d.includes('lib'));
  const hasPackages = relativeDirs.some(d => d === 'packages');
  const hasApps = relativeDirs.some(d => d === 'apps');
  const hasServices = relativeDirs.some(d => d === 'services');
  
  // Check for Python CLI entry points from pyproject.toml
  let hasPythonScripts = false;
  let hasPythonWebFramework = false;
  const pyprojectArchPath = join(rootDir, 'pyproject.toml');
  if (await fileExists(pyprojectArchPath)) {
    try {
      const pyContent = await readFile(pyprojectArchPath, 'utf-8');
      const pyproject = parsePyprojectToml(pyContent);

      // CLI entry points from [project.scripts]
      const scripts = pyproject?.project?.scripts;
      if (scripts && typeof scripts === 'object' && Object.keys(scripts).length > 0) {
        hasPythonScripts = true;
        for (const [cmdName, entryPoint] of Object.entries(scripts)) {
          if (typeof entryPoint === 'string') {
            architecture.entryPoints = architecture.entryPoints || [];
            architecture.entryPoints.push({
              file: entryPoint as string,
              purpose: `CLI command: ${cmdName}`
            });
          }
        }
      }

      // Check for web framework deps
      const deps: string[] = pyproject?.project?.dependencies || [];
      const depNames = deps.map(extractPyDepName);
      hasPythonWebFramework = depNames.some(d =>
        ['django', 'flask', 'fastapi', 'starlette', 'sanic', 'tornado', 'falcon', 'litestar'].includes(d)
      );
    } catch {}
  }

  // Python-specific entry points
  if (await fileExists(join(rootDir, 'manage.py'))) {
    architecture.entryPoints = architecture.entryPoints || [];
    architecture.entryPoints.push({ file: 'manage.py', purpose: 'Django management' });
  }

  // Rust architecture detection
  let hasRustBin = false;
  let hasRustLib = false;
  let hasRustWebFramework = false;
  let hasRustCliFramework = false;
  const cargoArchPath = join(rootDir, 'Cargo.toml');
  if (await fileExists(cargoArchPath)) {
    try {
      const cargoContent = await readFile(cargoArchPath, 'utf-8');
      const cargo = parsePyprojectToml(cargoContent);

      hasRustBin = await fileExists(join(rootDir, 'src/main.rs'));
      hasRustLib = await fileExists(join(rootDir, 'src/lib.rs'));

      const cargoDeps = Object.keys(cargo?.dependencies || {}).map(s => s.toLowerCase());
      hasRustWebFramework = cargoDeps.some(d => ['actix-web', 'axum', 'rocket', 'warp', 'tide'].includes(d));
      hasRustCliFramework = cargoDeps.some(d => ['clap', 'structopt'].includes(d));

      // Rust entry points
      if (hasRustBin) {
        architecture.entryPoints = architecture.entryPoints || [];
        architecture.entryPoints.push({ file: 'src/main.rs', purpose: 'Binary entry point' });
      }
      if (hasRustLib) {
        architecture.entryPoints = architecture.entryPoints || [];
        architecture.entryPoints.push({ file: 'src/lib.rs', purpose: 'Library entry point' });
      }
    } catch {}
  }

  // Go architecture detection
  let hasGoCmd = false;
  let hasGoWebFramework = false;
  let hasGoCliFramework = false;
  const goModArchPath = join(rootDir, 'go.mod');
  if (await fileExists(goModArchPath)) {
    try {
      const goModContent = await readFile(goModArchPath, 'utf-8');
      hasGoCmd = relativeDirs.some(d => d === 'cmd' || d.startsWith('cmd/'));
      const goMainExists = await fileExists(join(rootDir, 'main.go'));

      const goModLower = goModContent.toLowerCase();
      hasGoWebFramework = ['gin-gonic', 'labstack/echo', 'gofiber/fiber', 'go-chi/chi', 'gorilla/mux'].some(f => goModLower.includes(f));
      hasGoCliFramework = ['spf13/cobra', 'urfave/cli'].some(f => goModLower.includes(f));

      // Go entry points
      if (hasGoCmd) {
        architecture.entryPoints = architecture.entryPoints || [];
        architecture.entryPoints.push({ file: 'cmd/', purpose: 'CLI entry points' });
      } else if (goMainExists) {
        architecture.entryPoints = architecture.entryPoints || [];
        architecture.entryPoints.push({ file: 'main.go', purpose: 'Application entry' });
      }
    } catch {}
  }

  // === Score-based architecture type detection ===
  // Each signal contributes to a score for each type
  const typeScores: Record<string, number> = {
    monorepo: 0, microservices: 0, cli: 0, backend: 0,
    fullstack: 0, library: 0, frontend: 0
  };

  // Monorepo signals
  if (hasPackages || hasApps) typeScores.monorepo += 10;

  // Microservices signals
  if (hasServices) typeScores.microservices += 8;

  // CLI signals
  if (hasPythonScripts && !hasPythonWebFramework) typeScores.cli += 8;
  if (hasRustCliFramework && hasRustBin) typeScores.cli += 8;
  if (hasGoCliFramework || hasGoCmd) typeScores.cli += 8;
  if (await fileExists(join(rootDir, 'bin'))) typeScores.cli += 5;

  // Backend signals
  if (hasPythonWebFramework) typeScores.backend += 8;
  if (hasRustWebFramework) typeScores.backend += 8;
  if (hasGoWebFramework) typeScores.backend += 8;
  if (relativeDirs.some(d => d.includes('api'))) typeScores.backend += 2;

  // Fullstack signals
  if (hasApp && hasSrc) typeScores.fullstack += 5;
  if (hasPythonWebFramework && relativeDirs.some(d => d.includes('dashboard') || d.includes('frontend'))) typeScores.fullstack += 7;

  // Library signals
  if (hasLib && !hasApp && !hasPages) typeScores.library += 5;
  if (hasRustLib && !hasRustBin) typeScores.library += 8;

  // Frontend signals
  if (hasPages || (hasApp && !hasSrc && !hasServices)) typeScores.frontend += 5;

  // Pick highest score, with fallback
  const sortedTypes = Object.entries(typeScores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sortedTypes.length > 0) {
    architecture.type = sortedTypes[0][0] as any;
  } else {
    architecture.type = 'backend';
  }
  
  // Detect routing
  if (hasPages) {
    architecture.routing = 'file-based';
  } else if (relativeDirs.some(d => d.includes('app') && d.includes('routes'))) {
    architecture.routing = 'file-based';
  } else if (relativeDirs.some(d => d.includes('routes') || d.includes('router'))) {
    architecture.routing = 'config-based';
  }
  
  // Detect API style
  const packageJsonPath = join(rootDir, 'package.json');
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJSON<any>(packageJsonPath);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (allDeps['@trpc/server']) architecture.apiStyle = 'tRPC';
    else if (allDeps['graphql']) architecture.apiStyle = 'GraphQL';
    else if (allDeps['@grpc/grpc-js']) architecture.apiStyle = 'gRPC';
    else if (relativeDirs.some(d => d.includes('api') || d.includes('routes'))) architecture.apiStyle = 'REST';
  }
  
  // Detect state management
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJSON<any>(packageJsonPath);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (allDeps['zustand']) architecture.stateManagement = 'Zustand';
    else if (allDeps['@reduxjs/toolkit']) architecture.stateManagement = 'Redux Toolkit';
    else if (allDeps['redux']) architecture.stateManagement = 'Redux';
    else if (allDeps['jotai']) architecture.stateManagement = 'Jotai';
    else if (allDeps['recoil']) architecture.stateManagement = 'Recoil';
    else if (allDeps['mobx']) architecture.stateManagement = 'MobX';
  }
  
  // Detect patterns
  const patterns: string[] = [];
  if (relativeDirs.some(d => d.includes('components'))) patterns.push('Component-based architecture');
  if (relativeDirs.some(d => d.includes('hooks'))) patterns.push('Custom hooks pattern');
  if (relativeDirs.some(d => d.includes('utils'))) patterns.push('Utility modules');
  if (relativeDirs.some(d => d.includes('services'))) patterns.push('Service layer');
  if (relativeDirs.some(d => d.includes('store') || d.includes('state'))) patterns.push('State management');
  if (relativeDirs.some(d => d.includes('api'))) patterns.push('API routes');
  if (relativeDirs.some(d => d.includes('db') || d.includes('database'))) patterns.push('Database layer');
  if (relativeDirs.some(d => d.includes('config'))) patterns.push('Configuration management');
  if (relativeDirs.some(d => d.includes('middleware'))) patterns.push('Middleware pattern');
  if (relativeDirs.some(d => d.includes('providers'))) patterns.push('Provider pattern');
  if (relativeDirs.some(d => d.includes('context'))) patterns.push('Context API');
  if (relativeDirs.some(d => d.includes('layouts'))) patterns.push('Layout components');
  if (relativeDirs.some(d => d.includes('features'))) patterns.push('Feature-based organization');
  if (relativeDirs.some(d => d.includes('modules'))) patterns.push('Module pattern');
  if (relativeDirs.some(d => d.includes('agents'))) patterns.push('Agent-based architecture');
  if (relativeDirs.some(d => d.includes('missions') || d.includes('pipelines'))) patterns.push('Pipeline pattern');
  if (relativeDirs.some(d => d.includes('models') && !d.includes('node_modules'))) patterns.push('Data models');

  architecture.patterns = patterns;
  
  // Detect conventions
  const conventions: string[] = [];
  if (await fileExists(join(rootDir, '.prettierrc')) || await fileExists(join(rootDir, '.prettierrc.json'))) {
    conventions.push('Prettier code formatting');
  }
  if (await fileExists(join(rootDir, '.eslintrc.json')) || await fileExists(join(rootDir, '.eslintrc.js')) || await fileExists(join(rootDir, 'eslint.config.js'))) {
    conventions.push('ESLint code linting');
  }
  if (await fileExists(join(rootDir, 'tsconfig.json'))) {
    conventions.push('TypeScript strict mode');
  }
  if (await fileExists(join(rootDir, '.editorconfig'))) {
    conventions.push('EditorConfig');
  }
  if (await fileExists(join(rootDir, '.husky'))) {
    conventions.push('Git hooks (Husky)');
  }

  // Python conventions
  if (await fileExists(pyprojectArchPath)) {
    try {
      const pyContent = await readFile(pyprojectArchPath, 'utf-8');
      const pyproject = parsePyprojectToml(pyContent);

      if (pyproject?.tool?.ruff) conventions.push('Ruff code linting');
      if (pyproject?.tool?.black) conventions.push('Black code formatting');
      if (pyproject?.tool?.mypy) conventions.push('mypy type checking');
      if (pyproject?.tool?.isort) conventions.push('isort import sorting');
      if (pyproject?.tool?.pytest) conventions.push('pytest configuration');
    } catch {}
  }
  if (await fileExists(join(rootDir, '.flake8'))) {
    conventions.push('flake8 code linting');
  }
  if (await fileExists(join(rootDir, 'mypy.ini')) || await fileExists(join(rootDir, '.mypy.ini'))) {
    conventions.push('mypy type checking');
  }

  // Rust conventions
  if (await fileExists(cargoArchPath)) {
    if (await fileExists(join(rootDir, 'rustfmt.toml')) || await fileExists(join(rootDir, '.rustfmt.toml'))) {
      conventions.push('rustfmt code formatting');
    }
    if (await fileExists(join(rootDir, 'clippy.toml')) || await fileExists(join(rootDir, '.clippy.toml'))) {
      conventions.push('Clippy linting');
    }
    // Rust always has these by convention
    conventions.push('cargo fmt / cargo clippy');
  }

  // Go conventions
  if (await fileExists(goModArchPath)) {
    if (await fileExists(join(rootDir, '.golangci.yml')) || await fileExists(join(rootDir, '.golangci.yaml'))) {
      conventions.push('golangci-lint');
    }
    conventions.push('gofmt / go vet');
  }

  architecture.conventions = conventions;
  
  // Detect entry points (preserve any already detected, e.g. from pyproject.toml)
  const entryPoints: any[] = architecture.entryPoints || [];

  if (await fileExists(join(rootDir, 'src/index.ts'))) entryPoints.push({ file: 'src/index.ts', purpose: 'Main entry point' });
  else if (await fileExists(join(rootDir, 'src/index.tsx'))) entryPoints.push({ file: 'src/index.tsx', purpose: 'Main entry point' });
  else if (await fileExists(join(rootDir, 'index.ts'))) entryPoints.push({ file: 'index.ts', purpose: 'Main entry point' });

  if (await fileExists(join(rootDir, 'src/main.ts'))) entryPoints.push({ file: 'src/main.ts', purpose: 'Application entry' });
  if (await fileExists(join(rootDir, 'src/app.ts'))) entryPoints.push({ file: 'src/app.ts', purpose: 'Application setup' });
  if (await fileExists(join(rootDir, 'src/server.ts'))) entryPoints.push({ file: 'src/server.ts', purpose: 'Server entry' });

  architecture.entryPoints = entryPoints;

  // --- Source-level scanning ---
  try {
    const scanResult = await scanSources(rootDir);

    // Only include non-empty findings
    if (scanResult.reactPatterns.serverComponents.length > 0 ||
        scanResult.reactPatterns.clientComponents.length > 0 ||
        scanResult.reactPatterns.hooks.length > 0 ||
        scanResult.reactPatterns.providers.length > 0 ||
        scanResult.reactPatterns.layouts.length > 0 ||
        scanResult.reactPatterns.serverActions.length > 0) {
      const rp: Record<string, unknown> = {};
      if (scanResult.reactPatterns.serverComponents.length > 0) rp.serverComponents = scanResult.reactPatterns.serverComponents;
      if (scanResult.reactPatterns.clientComponents.length > 0) rp.clientComponents = scanResult.reactPatterns.clientComponents;
      if (scanResult.reactPatterns.serverActions.length > 0) rp.serverActions = scanResult.reactPatterns.serverActions;
      if (scanResult.reactPatterns.hooks.length > 0) rp.hooks = scanResult.reactPatterns.hooks;
      if (scanResult.reactPatterns.providers.length > 0) rp.providers = scanResult.reactPatterns.providers;
      if (scanResult.reactPatterns.layouts.length > 0) rp.layouts = scanResult.reactPatterns.layouts;
      (architecture as any).reactPatterns = rp;
    }

    if (scanResult.routes.length > 0) {
      (architecture as any).routes = scanResult.routes;
    }

    if (scanResult.middleware.length > 0) {
      (architecture as any).middleware = scanResult.middleware;
    }

    if (scanResult.apiEndpoints.length > 0) {
      (architecture as any).apiEndpoints = scanResult.apiEndpoints;
    }

    if (scanResult.keyFiles.length > 0) {
      (architecture as any).keyFiles = scanResult.keyFiles;
    }

    if (scanResult.importPatterns.internalAliases.length > 0 ||
        scanResult.importPatterns.heavyImporters.length > 0) {
      const ip: Record<string, unknown> = {};
      if (scanResult.importPatterns.internalAliases.length > 0) ip.internalAliases = scanResult.importPatterns.internalAliases;
      if (scanResult.importPatterns.heavyImporters.length > 0) ip.heavyImporters = scanResult.importPatterns.heavyImporters;
      (architecture as any).importPatterns = ip;
    }

    // Enrich existing patterns array with source-level findings
    if (scanResult.reactPatterns.serverComponents.length > 0 ||
        scanResult.reactPatterns.clientComponents.length > 0) {
      if (!architecture.patterns) architecture.patterns = [];
      if (!architecture.patterns.includes('React Server Components')) {
        architecture.patterns.push('React Server Components');
      }
    }
    if (scanResult.reactPatterns.serverActions.length > 0) {
      if (!architecture.patterns) architecture.patterns = [];
      if (!architecture.patterns.includes('Server Actions')) {
        architecture.patterns.push('Server Actions');
      }
    }
  } catch (error) {
    // Source scanning is best-effort — don't fail inference if it errors
    // The architecture result will just lack source-level fields
  }

  return architecture as Architecture;
}

export async function inferConstraints(rootDir: string): Promise<Constraints> {
  // --- MODIFIED INITIALIZATION ---
  const constraints: Partial<Constraints> = {
    $schema: `${SCHEMA_URL}/constraints.schema.json`,
    version: PRELUDE_VERSION,
    mustUse: [],
    mustNotUse: [],
    preferences: []
  };
  
  // Check for ESLint
  if (await fileExists(join(rootDir, '.eslintrc.json')) || 
      await fileExists(join(rootDir, '.eslintrc.js')) ||
      await fileExists(join(rootDir, 'eslint.config.js'))) {
    constraints.codeStyle = {
      linter: 'ESLint'
    };
    
    // Try to read ESLint config for rules
    try {
      let eslintConfig: any;
      if (await fileExists(join(rootDir, '.eslintrc.json'))) {
        eslintConfig = await readJSON(join(rootDir, '.eslintrc.json'));
      }
      
      if (eslintConfig?.extends) {
        const rules: string[] = [];
        if (Array.isArray(eslintConfig.extends)) {
          rules.push(...eslintConfig.extends);
        } else {
          rules.push(eslintConfig.extends);
        }
        constraints.codeStyle.rules = rules;
      }
    } catch {}
  }
  
  // Check for Prettier
  if (await fileExists(join(rootDir, '.prettierrc')) ||
      await fileExists(join(rootDir, '.prettierrc.json')) ||
      await fileExists(join(rootDir, 'prettier.config.js'))) {
    constraints.codeStyle = {
      ...constraints.codeStyle,
      formatter: 'Prettier'
    };
  }
  
  // Python code style tools
  const pyprojectConstraintsPath = join(rootDir, 'pyproject.toml');
  if (await fileExists(pyprojectConstraintsPath)) {
    try {
      const pyContent = await readFile(pyprojectConstraintsPath, 'utf-8');
      const pyproject = parsePyprojectToml(pyContent);

      // Linter
      if (pyproject?.tool?.ruff) {
        constraints.codeStyle = {
          ...constraints.codeStyle,
          linter: 'Ruff'
        };
        const targetVersion = pyproject.tool.ruff['target-version'];
        if (targetVersion && typeof targetVersion === 'string') {
          // py311 → 3.11, py39 → 3.9
          const nums = targetVersion.replace('py', '');
          const major = nums[0];
          const minor = nums.slice(1);
          if (major && minor) {
            constraints.mustUse?.push(`Python ${major}.${minor}+`);
          }
        }
        const lineLength = pyproject.tool.ruff['line-length'];
        if (lineLength) {
          constraints.preferences?.push({
            category: 'Code Style',
            preference: `Line length: ${lineLength}`,
            rationale: 'Ruff configuration'
          });
        }
      }
      if (pyproject?.tool?.black) {
        constraints.codeStyle = {
          ...constraints.codeStyle,
          formatter: 'Black'
        };
      }
      if (pyproject?.tool?.mypy) {
        constraints.mustUse?.push('mypy for type checking');
      }

      // Python version constraint (only if not already added from Ruff target-version)
      const requiresPython = pyproject?.project?.['requires-python'];
      if (requiresPython && !constraints.mustUse?.some(m => m.startsWith('Python '))) {
        constraints.mustUse?.push(`Python ${requiresPython}`);
      }

      // Testing from pyproject
      const deps: string[] = pyproject?.project?.dependencies || [];
      const optDeps = pyproject?.project?.['optional-dependencies'] || {};
      const allDepNames = new Set([
        ...deps.map(extractPyDepName),
        ...Object.values(optDeps).flat().filter((d): d is string => typeof d === 'string').map(extractPyDepName)
      ]);

      if (allDepNames.has('pytest') || pyproject?.tool?.pytest) {
        constraints.testing = {
          required: true,
          strategy: 'pytest'
        };
      }
    } catch {}
  }
  if (await fileExists(join(rootDir, '.flake8'))) {
    constraints.codeStyle = {
      ...constraints.codeStyle,
      linter: constraints.codeStyle?.linter || 'flake8'
    };
  }

  // Check for TypeScript
  if (await fileExists(join(rootDir, 'tsconfig.json'))) {
    constraints.mustUse?.push('TypeScript for type safety');
    
    // Try to read tsconfig for strictness
    try {
      const tsconfig = await readJSON<any>(join(rootDir, 'tsconfig.json'));
      if (tsconfig.compilerOptions?.strict) {
        constraints.mustUse?.push('TypeScript strict mode');
      }
    } catch {}
  }
  
  // Check for Tailwind
  if (await fileExists(join(rootDir, 'tailwind.config.js')) ||
      await fileExists(join(rootDir, 'tailwind.config.ts'))) {
    constraints.mustUse?.push('Tailwind CSS for styling');
  }
  
  // Check for testing requirements
  const packageJsonPath = join(rootDir, 'package.json');
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJSON<any>(packageJsonPath);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (allDeps['vitest'] || allDeps['jest'] || allDeps['@playwright/test']) {
      constraints.testing = {
        required: true,
        strategy: 'Unit and integration tests'
      };
      
      // Check for coverage requirements
      if (pkg.scripts?.['test:coverage']) {
        constraints.testing.coverage = 80; // Default assumption
      }
    }
    
    // Check for monorepo tools
    if (allDeps['turbo'] || await fileExists(join(rootDir, 'turbo.json'))) {
      constraints.mustUse?.push('Turborepo for monorepo management');
    }
    
    if (allDeps['nx'] || await fileExists(join(rootDir, 'nx.json'))) {
      constraints.mustUse?.push('Nx for monorepo management');
    }
    
    // Check for commit conventions
    if (allDeps['@commitlint/cli']) {
      constraints.preferences?.push({
        category: 'Version Control',
        preference: 'Conventional Commits',
        rationale: 'Standardized commit messages'
      });
    }
    
    // Check for code quality tools
    if (allDeps['husky']) {
      constraints.preferences?.push({
        category: 'Code Quality',
        preference: 'Git hooks with Husky',
        rationale: 'Pre-commit and pre-push validations'
      });
    }
  }
  
  // Detect naming conventions from actual files
  const naming: any = {};
  
  // Check component naming
  const componentsDir = join(rootDir, 'src/components');
  if (await fileExists(componentsDir)) {
    const files = await readdir(componentsDir);
    const hasPascalCase = files.some(f => /^[A-Z]/.test(f));
    const hasKebabCase = files.some(f => f.includes('-'));
    
    if (hasPascalCase) naming.components = 'PascalCase';
    else if (hasKebabCase) naming.components = 'kebab-case';
  }
  
  if (Object.keys(naming).length > 0) {
    constraints.naming = naming;
  }
  
  // File organization preferences
  const fileOrg: string[] = [];
  if (await fileExists(join(rootDir, 'src'))) fileOrg.push('All source code in src/ directory');
  if (await fileExists(join(rootDir, 'src/components'))) fileOrg.push('Components organized by feature or type');
  if (await fileExists(join(rootDir, 'src/lib'))) fileOrg.push('Shared utilities in lib/ directory');
  
  constraints.fileOrganization = fileOrg;
  
  // Documentation requirements
  if (await fileExists(join(rootDir, 'README.md'))) {
    constraints.documentation = {
      required: true,
      style: 'Markdown'
    };
  }
  
  // Performance constraints
  const performance: string[] = [];
  const packageJsonExists = await fileExists(packageJsonPath);
  if (packageJsonExists) {
    const pkg = await readJSON<any>(packageJsonPath);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (allDeps['@next/bundle-analyzer']) performance.push('Bundle size monitoring');
    if (allDeps['lighthouse']) performance.push('Lighthouse CI');
    if (allDeps['web-vitals']) performance.push('Web Vitals tracking');
  }
  
  if (performance.length > 0) {
    constraints.performance = performance;
  }
  
  // Security constraints
  const security: string[] = [];
  if (await fileExists(join(rootDir, '.env.example'))) {
    security.push('Environment variables documented in .env.example');
  }
  
  const envFiles = await detectEnvFiles(rootDir);
  if (envFiles.length > 0) {
    security.push('Separate .env files for different environments');
  }
  
  if (security.length > 0) {
    constraints.security = security;
  }
  
  return constraints as Constraints;
}