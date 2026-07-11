# HappyHome

HappyHome is a WeChat mini-program community product with a Vue admin site and CloudBase backend. The monorepo also contains cited formal-post RAG search.

## Components

- `miniprogram/`: uni-app / Vue 3 mini-program client.
- `admin-web/`: Vue 3 management site.
- `cloud/`: CloudBase functions and shared business libraries.
- `scripts/`: verification, worktree, integration, and release tooling.

## Start here

```powershell
npm.cmd ci
npm.cmd run hooks:install
npm.cmd run worktree:doctor
```

- [AGENTS.md](./AGENTS.md) defines mandatory PR, CI, worktree, and production boundaries.
- [CLAUDE.md](./CLAUDE.md) defines the repository collaboration playbook.
- [Documentation map](./docs/README.md) identifies current authorities, runbooks, references, and historical records.
- [TASKS.md](./TASKS.md) contains only open, claimable project work.

## Common local checks

```powershell
npm.cmd --workspace cloud test
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace miniprogram run type-check
npm.cmd run docs:check
```

Release commands, evidence requirements, upload policy, and production verification live only in the [release gate](./docs/release-gate.md).

Use Node 24 and npm 11. Feature work uses an isolated `codex/<feature>` branch and enters `main` through a passing pull request and merge queue.
