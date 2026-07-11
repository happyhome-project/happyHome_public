# HappyHome

HappyHome is a WeChat mini-program community product with a Vue admin site and CloudBase backend. It includes formal post RAG search with cited answers.

## Components

- `miniprogram/`: uni-app / Vue 3 mini-program client.
- `admin-web/`: Vue 3 management site.
- `cloud/`: CloudBase functions and shared business libraries.
- `scripts/`: release, indexing, verification, and operational tooling.

## Start Here

```powershell
npm.cmd ci
npm.cmd run hooks:install
```

Read [CLAUDE.md](./CLAUDE.md) for project conventions and [AGENTS.md](./AGENTS.md) for the mandatory PR, CI, worktree, and release boundaries.

## Common Commands

```powershell
# Cloud tests
npm.cmd --workspace cloud test

# PR integration and release state
npm.cmd run integrate:pr -- --pr <number>
npm.cmd run release:pending
npm.cmd run release:status
# Repairs a local running ledger only after the remote state proves the same SHA/run passed and no production lock remains.
npm.cmd run release:reconcile -- --run-id=<id>

# Formal RAG verification with a temporary, self-cleaning fixture
npm.cmd run verify:post-rag-smoke
```

Production work is performed from `main` in `C:\Project\Claude\happyHome`; feature branches must use their own worktree and enter through a passing PR.

## Documentation

- [Documentation map](./docs/README.md): canonical document entry point.
- [Setup](./docs/SETUP.md): local environment and CloudBase deployment setup.
- [Post RAG Search](./docs/post-rag-search.md): architecture, operations, cost boundaries, and RAG smoke acceptance.
- [Testing](./docs/TESTING.md): test layers and commands.
- [Release Gate](./docs/release-gate.md): formal release evidence and CloudBase deployment rules.
- [Session Handoff](./docs/SESSION-HANDOFF.md): current operational state for a new session.

Use Node 24 and npm 11. Read [AGENTS.md](./AGENTS.md) for mandatory PR/CI/worktree/release boundaries, [CLAUDE.md](./CLAUDE.md) for collaboration guidance, and [memory/MEMORY.md](./memory/MEMORY.md) for the project memory index.
