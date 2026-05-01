import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { inferProjectMetadata, inferStack, inferArchitecture } from '../src/core/infer.js';

describe('Rust project inference', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-rust-test-'));

    await writeFile(join(tempDir, 'Cargo.toml'), `
[package]
name = "my-api"
version = "0.3.0"
edition = "2021"
description = "A REST API built with Axum"
license = "Apache-2.0"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio"] }
redis = "0.25"
clap = { version = "4", features = ["derive"] }

[dev-dependencies]
criterion = "0.5"
rstest = "0.18"
`);

    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'main.rs'), `
fn main() {
    println!("Hello, world!");
}
`);
    await writeFile(join(tempDir, 'src', 'lib.rs'), `
pub mod routes;
pub mod db;
`);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect Rust language and cargo package manager', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.language).toBe('Rust');
    expect(stack.packageManager).toBe('cargo');
  });

  it('should detect Rust edition as runtime', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.runtime).toBe('Rust Edition 2021');
  });

  it('should detect Rust frameworks', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.frameworks).toContain('Axum');
    expect(stack.frameworks).toContain('Tokio');
    expect(stack.frameworks).toContain('Serde');
    expect(stack.frameworks).toContain('Clap');
  });

  it('should detect Rust dependencies', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.dependencies).toBeDefined();
    expect(stack.dependencies!['axum']).toBeDefined();
  });

  it('should detect Rust testing frameworks', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.testingFrameworks).toContain('cargo test (built-in)');
    expect(stack.testingFrameworks).toContain('Criterion (benchmarks)');
    expect(stack.testingFrameworks).toContain('rstest');
  });

  it('should detect Rust ORM and databases', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.orm).toBe('SQLx');
    expect(stack.database).toContain('PostgreSQL');
    expect(stack.database).toContain('Redis');
  });

  it('should detect project metadata from Cargo.toml', async () => {
    const project = await inferProjectMetadata(tempDir);
    expect(project.name).toBe('my-api');
    expect(project.description).toBe('A REST API built with Axum');
    expect(project.projectVersion).toBe('0.3.0');
    expect(project.license).toBe('Apache-2.0');
  });

  it('should detect architecture type for Rust project', async () => {
    const arch = await inferArchitecture(tempDir);
    // Project has both axum (web) and clap (cli), so either is reasonable
    expect(['backend', 'cli']).toContain(arch.type);
  });

  it('should detect Rust entry points', async () => {
    const arch = await inferArchitecture(tempDir);
    const mainEntry = arch.entryPoints?.find(ep => ep.file === 'src/main.rs');
    expect(mainEntry).toBeDefined();
    const libEntry = arch.entryPoints?.find(ep => ep.file === 'src/lib.rs');
    expect(libEntry).toBeDefined();
  });

  it('should detect Rust conventions', async () => {
    const arch = await inferArchitecture(tempDir);
    expect(arch.conventions).toContain('cargo fmt / cargo clippy');
  });
});

describe('Go project inference', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prelude-go-test-'));

    await writeFile(join(tempDir, 'go.mod'), `
module github.com/example/myapp

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/spf13/cobra v1.8.0
	github.com/lib/pq v1.10.9
	github.com/stretchr/testify v1.8.4
	github.com/spf13/viper v1.18.0
	gorm.io/gorm v1.25.5
)
`);

    await mkdir(join(tempDir, 'cmd', 'server'), { recursive: true });
    await writeFile(join(tempDir, 'main.go'), `
package main

func main() {}
`);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect Go language and package manager', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.language).toBe('Go');
    expect(stack.packageManager).toBe('go');
  });

  it('should detect Go version as runtime', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.runtime).toBe('Go 1.22');
  });

  it('should detect Go frameworks', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.frameworks).toContain('Gin');
    expect(stack.frameworks).toContain('Cobra');
    expect(stack.frameworks).toContain('Viper');
  });

  it('should detect Go dependencies', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.dependencies).toBeDefined();
    expect(Object.keys(stack.dependencies!).length).toBeGreaterThan(0);
  });

  it('should detect Go testing', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.testingFrameworks).toContain('go test (built-in)');
    expect(stack.testingFrameworks).toContain('Testify');
  });

  it('should detect Go ORM and database', async () => {
    const stack = await inferStack(tempDir);
    expect(stack.orm).toBe('GORM');
    expect(stack.database).toContain('PostgreSQL');
  });

  it('should detect CLI architecture type with cmd/', async () => {
    const arch = await inferArchitecture(tempDir);
    expect(arch.type).toBe('cli');
  });

  it('should detect Go conventions', async () => {
    const arch = await inferArchitecture(tempDir);
    expect(arch.conventions).toContain('gofmt / go vet');
  });

  it('should detect Go entry points', async () => {
    const arch = await inferArchitecture(tempDir);
    const cmdEntry = arch.entryPoints?.find(ep => ep.file === 'cmd/');
    expect(cmdEntry).toBeDefined();
  });
});
