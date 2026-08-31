# HappyHome

HappyHome is a WeChat mini-program community product with a Vue admin site and CloudBase backend. The monorepo also contains cited formal-post RAG search.

## Components

- `miniprogram/`: uni-app / Vue 3 client for community browsing, topic/archive feeds, search, media/text posts, collaboration, and member/profile flows.
- `admin-web/`: Vue 3 management site with separate super-admin and community-admin routes for communities, content, members, moderation, and configuration.
- `cloud/`: CloudBase functions and shared business libraries for those flows, approval notifications, WeChat media-audit callbacks, and formal-post RAG.
- `scripts/`: verification, worktree, integration, and release tooling.
- `wechat-ops/`: separate official analytics/customer-service utilities; not a mini-program publishing path.

These are implemented surfaces, not a claim that every journey has current production acceptance evidence. Comments/likes remain open work in `TASKS.md`; formal publication does not certify RAG retrieval quality or select the uploaded development build as the WeChat trial version.

## Start here

```powershell
npm.cmd ci
npm.cmd run hooks:install
npm.cmd run worktree:doctor
```

- [AGENTS.md](./AGENTS.md) defines mandatory PR, CI, worktree, and production boundaries.
- [CLAUDE.md](./CLAUDE.md) defines the repository collaboration playbook.
- [PRODUCT.md](./PRODUCT.md) defines the current product positioning baseline.
- [Documentation map](./docs/README.md) identifies current authorities, runbooks, references, and historical records.
- [TASKS.md](./TASKS.md) contains only open, claimable project work.

## Common local checks

```powershell
npm.cmd --workspace cloud test
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace miniprogram run type-check
npm.cmd run docs:check
```

Cross-component formal release orchestration, mandatory gates, evidence, upload policy, and final production verification live in the [release gate](./docs/release-gate.md). Component guides may retain component-specific build or deployment reference material, but they do not define a formal HappyHome release.

Use Node 24 and npm 11. Feature work uses an isolated `codex/<feature>` branch and enters `main` through a passing pull request and merge queue.
