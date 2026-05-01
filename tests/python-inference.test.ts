import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { inferProjectMetadata, inferStack, inferArchitecture, inferConstraints } from '../src/core/infer.js';

describe('Python project inference', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-python-test-'));

    // Create a realistic pyproject.toml
    await writeFile(join(tempDir, 'pyproject.toml'), `
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "test-cli-tool"
version = "2.1.0"
description = "A test CLI tool for validation"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.11"
authors = [
    {name = "Test Author", email = "test@example.com"}
]

dependencies = [
    "typer>=0.9.0",
    "rich>=13.7.0",
    "pydantic>=2.0",
    "httpx>=0.28.0",
    "loguru>=0.7.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "ruff>=0.3.0",
]

[project.scripts]
mytool = "test_cli_tool.cli:app"

[tool.ruff]
target-version = "py311"
line-length = 100

[tool.pytest.ini_options]
testpaths = ["tests"]
`);

    // Create project structure
    await mkdir(join(tempDir, 'test_cli_tool'), { recursive: true });
    await mkdir(join(tempDir, 'test_cli_tool', 'agents'), { recursive: true });
    await mkdir(join(tempDir, 'tests'), { recursive: true });

    // Create a CLI entry point
    await writeFile(join(tempDir, 'test_cli_tool', 'cli.py'), `
import typer
from rich.console import Console

app = typer.Typer()
console = Console()

@app.command()
def run(task: str):
    console.print(f"Running {task}")

@app.command()
def status():
    console.print("OK")
`);

    // Create a conftest.py
    await writeFile(join(tempDir, 'tests', 'conftest.py'), `
import pytest

@pytest.fixture
def sample_data():
    return {"key": "value"}
`);

    // Create __main__.py
    await writeFile(join(tempDir, 'test_cli_tool', '__main__.py'), `
from .cli import app
app()
`);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('inferProjectMetadata', () => {
    it('should read name and description from pyproject.toml', async () => {
      const project = await inferProjectMetadata(tempDir);
      expect(project.name).toBe('test-cli-tool');
      expect(project.description).toBe('A test CLI tool for validation');
    });

    it('should read version from pyproject.toml', async () => {
      const project = await inferProjectMetadata(tempDir);
      expect(project.projectVersion).toBe('2.1.0');
    });

    it('should read license from pyproject.toml inline table', async () => {
      const project = await inferProjectMetadata(tempDir);
      expect(project.license).toBe('MIT');
    });

    it('should read team from pyproject.toml authors', async () => {
      const project = await inferProjectMetadata(tempDir);
      expect(project.team).toHaveLength(1);
      expect(project.team![0].name).toBe('Test Author');
    });
  });

  describe('inferStack', () => {
    it('should detect Python language', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.language).toBe('Python');
    });

    it('should detect pip package manager for setuptools projects', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.packageManager).toBe('pip');
    });

    it('should detect Python runtime version', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.runtime).toBe('Python >=3.11');
    });

    it('should parse dependencies from pyproject.toml', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.dependencies).toBeDefined();
      expect(stack.dependencies!['typer']).toBeDefined();
      expect(stack.dependencies!['rich']).toBeDefined();
      expect(stack.dependencies!['pydantic']).toBeDefined();
      expect(stack.dependencies!['httpx']).toBeDefined();
    });

    it('should parse dev dependencies from optional-dependencies', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.devDependencies).toBeDefined();
      expect(stack.devDependencies!['pytest']).toBeDefined();
      expect(stack.devDependencies!['ruff']).toBeDefined();
    });

    it('should detect frameworks', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.frameworks).toContain('Typer');
    });

    it('should detect testing frameworks', async () => {
      const stack = await inferStack(tempDir);
      expect(stack.testingFrameworks).toContain('pytest');
    });
  });

  describe('inferArchitecture', () => {
    it('should detect CLI architecture type for projects with scripts', async () => {
      const arch = await inferArchitecture(tempDir);
      expect(arch.type).toBe('cli');
    });

    it('should include Python CLI entry points from pyproject.toml', async () => {
      const arch = await inferArchitecture(tempDir);
      const cliEntry = arch.entryPoints?.find(ep => ep.purpose.includes('mytool'));
      expect(cliEntry).toBeDefined();
      expect(cliEntry!.file).toBe('test_cli_tool.cli:app');
    });

    it('should detect agent-based architecture pattern', async () => {
      const arch = await inferArchitecture(tempDir);
      expect(arch.patterns).toContain('Agent-based architecture');
    });

    it('should detect Python conventions', async () => {
      const arch = await inferArchitecture(tempDir);
      expect(arch.conventions).toContain('Ruff code linting');
      expect(arch.conventions).toContain('pytest configuration');
    });

    it('should filter out __pycache__ directories', async () => {
      // Create a __pycache__ dir
      await mkdir(join(tempDir, 'test_cli_tool', '__pycache__'), { recursive: true });
      await writeFile(join(tempDir, 'test_cli_tool', '__pycache__', 'cli.cpython-311.pyc'), '');

      const arch = await inferArchitecture(tempDir);
      const dirPaths = arch.directories.map(d => d.path);
      const hasPycache = dirPaths.some(p => p.includes('__pycache__'));
      expect(hasPycache).toBe(false);
    });

    it('should detect Python key files', async () => {
      const arch = await inferArchitecture(tempDir);
      const keyFiles = (arch as any).keyFiles || [];
      const cliFile = keyFiles.find((kf: any) => kf.file.includes('cli.py'));
      expect(cliFile).toBeDefined();
      expect(cliFile.role).toBe('CLI entry point');
    });
  });

  describe('inferConstraints', () => {
    it('should detect Ruff as linter', async () => {
      const constraints = await inferConstraints(tempDir);
      expect(constraints.codeStyle?.linter).toBe('Ruff');
    });

    it('should detect Python version constraint', async () => {
      const constraints = await inferConstraints(tempDir);
      expect(constraints.mustUse).toBeDefined();
      const pythonConstraint = constraints.mustUse!.find(m => m.startsWith('Python '));
      expect(pythonConstraint).toBeDefined();
    });

    it('should detect line length preference from Ruff config', async () => {
      const constraints = await inferConstraints(tempDir);
      const lineLength = constraints.preferences?.find(p => p.preference.includes('100'));
      expect(lineLength).toBeDefined();
    });

    it('should detect pytest testing requirement', async () => {
      const constraints = await inferConstraints(tempDir);
      expect(constraints.testing?.required).toBe(true);
      expect(constraints.testing?.strategy).toBe('pytest');
    });
  });
});

describe('Python project with requirements.txt only', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-python-req-test-'));

    await writeFile(join(tempDir, 'requirements.txt'), `
# Web framework
flask>=2.3.0
sqlalchemy>=2.0
redis>=5.0
gunicorn>=21.2

# Dev
pytest>=7.4.0
`);

    await writeFile(join(tempDir, 'README.md'), `# My Flask App

A simple web application built with Flask and SQLAlchemy.
`);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect language and package manager from requirements.txt', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.language).toBe('Python');
    expect(stack.packageManager).toBe('pip');
  });

  it('should detect frameworks from requirements.txt', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.frameworks).toContain('Flask');
  });

  it('should detect ORM from requirements.txt', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.orm).toBe('SQLAlchemy');
  });

  it('should detect database from requirements.txt', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.database).toContain('Redis');
  });

  it('should detect testing from requirements.txt', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.testingFrameworks).toContain('pytest');
  });

  it('should read description from README when no pyproject.toml', async () => {
    const project = await inferProjectMetadata(tempDir);
    expect(project.description).toContain('Flask and SQLAlchemy');
  });
});

describe('pyproject.toml parser edge cases', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-toml-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect poetry package manager from build-backend', async () => {
    await writeFile(join(tempDir, 'pyproject.toml'), `
[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"

[project]
name = "poetry-project"
version = "1.0.0"
description = "A poetry project"
dependencies = []
`);

    const stack = await inferStack(tempDir);
    expect(stack.packageManager).toBe('poetry');
  });

  it('should detect FastAPI as backend type', async () => {
    await writeFile(join(tempDir, 'pyproject.toml'), `
[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"

[project]
name = "api-project"
version = "1.0.0"
description = "An API"
dependencies = [
    "fastapi>=0.100.0",
    "uvicorn>=0.20.0",
]
`);

    const arch = await inferArchitecture(tempDir);
    expect(arch.type).toBe('backend');
  });
});
