# Prelude

> The open standard for expressing and maintaining machine-readable context about a codebase

## Overview

Prelude enables AI tools, agents, and teams to reason with continuity, precision, and shared understanding by providing a structured `.context/` directory format.

## Quick Start

```bash
# Install dependencies
pnpm install

# Initialize Prelude in your project
pnpm prelude init

# Export context for LLM consumption
pnpm prelude export

# Watch for changes
pnpm prelude watch
```

## Commands

- `prelude init` - Scaffold `.context/` with inferred metadata
- `prelude export` - Generate LLM-optimized export
- `prelude decision` - Log architectural decisions
- `prelude watch` - Track changes to stack and architecture

## Development

```bash
# Run in development mode
pnpm dev

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT
