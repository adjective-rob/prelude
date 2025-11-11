import { readdir, stat, readFile } from 'fs/promises';
import { join, basename, relative } from 'path';
import { fileExists, readJSON, getDirectoryTree } from '../utils/fs.js';
import { getCurrentTimestamp } from '../utils/time.js';
import type { Project, Stack, Architecture, Constraints } from '../schema/index.js';

// --- ADD THESE CONSTANTS ---
const PRELUDE_VERSION = "1.0.0";
const SCHEMA_URL = "https://adjective.us/prelude/schemas/v1";
// --------------------------

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
  
  // Try to read README for better description
  let description = projectData.description || 'No description provided';
  const readmePath = join(rootDir, 'README.md');
  if (await fileExists(readmePath)) {
    try {
      const readme = await readFile(readmePath, 'utf-8');
      const lines = readme.split('\n').filter(l => l.trim());
      // Try to get first meaningful paragraph
      const firstParagraph = lines.find(l => !l.startsWith('#') && l.length > 20);
      if (firstParagraph && (!projectData.description || projectData.description === '')) {
        description = firstParagraph.slice(0, 200);
      }
    } catch {}
  }
  
  const name = projectData.name || basename(rootDir);
  const projectVersion = projectData.version; // Use the renamed field
  const repository = projectData.repository?.url || projectData.repository;
  const license = projectData.license;
  const homepage = projectData.homepage;
  
  // Detect team info from package.json
  const team = [];
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
  
  return {
    $schema: `${SCHEMA_URL}/project.schema.json`,
    version: PRELUDE_VERSION,
    name,
    description,
    projectVersion, // Correctly use renamed field
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
    let allDeps: Record<string, string> = {};
    
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
  
  if (await fileExists(requirementsPath) || await fileExists(pyprojectPath)) {
    stack.language = 'Python';
    stack.packageManager = await fileExists(pyprojectPath) ? 'poetry' : 'pip';
    
    // Check for common Python frameworks
    if (await fileExists(requirementsPath)) {
      const requirements = await readFile(requirementsPath, 'utf-8');
      const frameworks: string[] = [];
      
      if (requirements.includes('django')) frameworks.push('Django');
      if (requirements.includes('flask')) frameworks.push('Flask');
      if (requirements.includes('fastapi')) frameworks.push('FastAPI');
      if (requirements.includes('tornado')) frameworks.push('Tornado');
      if (requirements.includes('pyramid')) frameworks.push('Pyramid');
      
      stack.frameworks = frameworks;
    }
  }
  
  // Check for Rust project
  const cargoPath = join(rootDir, 'Cargo.toml');
  if (await fileExists(cargoPath)) {
    stack.language = 'Rust';
    stack.packageManager = 'cargo';
  }
  
  // Check for Go project
  const goModPath = join(rootDir, 'go.mod');
  if (await fileExists(goModPath)) {
    stack.language = 'Go';
    stack.packageManager = 'go';
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
  
  if (hasPackages || hasApps) {
    architecture.type = 'monorepo';
  } else if (hasServices) {
    architecture.type = 'microservices';
  } else if (hasApp && hasSrc) {
    architecture.type = 'fullstack';
  } else if (hasLib && !hasApp) {
    architecture.type = 'library';
  } else if (await fileExists(join(rootDir, 'bin'))) {
    architecture.type = 'cli';
  } else if (hasPages || hasApp) {
    architecture.type = 'frontend';
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
  
  architecture.conventions = conventions;
  
  // Detect entry points
  const entryPoints: any[] = [];
  
  if (await fileExists(join(rootDir, 'src/index.ts'))) entryPoints.push({ file: 'src/index.ts', purpose: 'Main entry point' });
  else if (await fileExists(join(rootDir, 'src/index.tsx'))) entryPoints.push({ file: 'src/index.tsx', purpose: 'Main entry point' });
  else if (await fileExists(join(rootDir, 'index.ts'))) entryPoints.push({ file: 'index.ts', purpose: 'Main entry point' });
  
  if (await fileExists(join(rootDir, 'src/main.ts'))) entryPoints.push({ file: 'src/main.ts', purpose: 'Application entry' });
  if (await fileExists(join(rootDir, 'src/app.ts'))) entryPoints.push({ file: 'src/app.ts', purpose: 'Application setup' });
  if (await fileExists(join(rootDir, 'src/server.ts'))) entryPoints.push({ file: 'src/server.ts', purpose: 'Server entry' });
  
  architecture.entryPoints = entryPoints;
  
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