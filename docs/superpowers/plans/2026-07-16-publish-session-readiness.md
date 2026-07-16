# Publish Session Readiness Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-16 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current publishing code, cloud authorization checks, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove blocking membership rechecks from all publish entry paths and reuse authenticated session data for collaboration templates.

**Architecture:** The community Pinia store becomes the single client-side source for active membership and collaboration-template readiness. Login and home bootstrap hydrate it; the create page consumes it and leaves final authorization to cloud submit APIs.

**Tech Stack:** Vue 3, Pinia, uni-app, TypeScript, Vitest

---

### Task 1: Hydrate publish session state

**Files:**
- Modify: `miniprogram/src/store/community.ts`
- Modify: `miniprogram/src/store/__tests__/community.test.ts`

- [ ] Write failing tests proving active community lists hydrate `membershipByCommunity` and collaboration templates can be replaced atomically.
- [ ] Run `npm.cmd exec -- vitest run src/store/__tests__/community.test.ts --pool=forks --maxWorkers=1` and confirm the new assertions fail.
- [ ] Add focused store actions for active membership hydration and collaboration-template hydration.
- [ ] Rerun the focused test and confirm it passes.

### Task 2: Establish membership during login and home bootstrap

**Files:**
- Modify: `miniprogram/src/store/user.ts`
- Modify: `miniprogram/src/store/__tests__/user-web-auth.test.ts`
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] Write failing tests proving direct and Web login load active communities before resolving.
- [ ] Run the focused user-store test and confirm failure.
- [ ] Add a best-effort membership hydration step after each successful login and sync authenticated home snapshots into the community store.
- [ ] Rerun focused tests and confirm they pass.

### Task 3: Make every publish entry consume session readiness

**Files:**
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/utils/__tests__/collaboration-template-flow.test.ts`
- Modify: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`

- [ ] Write failing static regression assertions that ordinary entry never calls `member.myStatus`, archive editors enter synchronously, and collaboration templates prefer the store snapshot.
- [ ] Run both focused test files and confirm failure.
- [ ] Replace page-owned membership networking with computed store membership, and initialize collaboration templates from the shared store before the fallback request.
- [ ] Rerun focused tests and confirm they pass.

### Task 4: Verify and publish

**Files:**
- Verify all changed files above.

- [ ] Run `npm.cmd run test:unit` in `miniprogram`.
- [ ] Run `npm.cmd run type-check` in `miniprogram`.
- [ ] Run `npm.cmd run build:mp-weixin` in `miniprogram`.
- [ ] Run `git diff --check`, review the complete diff, commit as AngryBird, push, and open a ready PR.
- [ ] Follow exact-HEAD CI and Merge Queue through `MERGED`, then retire this worktree with the guarded repository command.
