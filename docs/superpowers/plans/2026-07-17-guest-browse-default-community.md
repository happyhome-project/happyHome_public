# Guest Browse Default Community Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-17 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, guest-intro configuration, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the guest secondary action to close the mask and reveal the prefetched default public community.

**Architecture:** Keep startup bootstrap as the single source of default-community data. Change the shared default/legacy normalization and simplify the home secondary handler so it only marks the intro seen; retain a loading cover while the dismissed guest view has no accepted public snapshot.

**Tech Stack:** Vue 3, uni-app, TypeScript, Vitest, WeChat mini-program build.

---

### Task 1: Lock the browse behavior with failing tests

**Files:**
- Modify: `miniprogram/src/utils/__tests__/guest-intro.test.ts`
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`

- [ ] Assert that the shared default and legacy normalized text are “先随便看看”.
- [ ] Assert that the home template has no secondary plus icon and the handler marks the intro seen without onboarding navigation.
- [ ] Assert that a dismissed signed-out intro with unresolved public data selects the entry loading cover.
- [ ] Run the focused Vitest files and confirm the assertions fail for the old creation behavior.

### Task 2: Implement the minimal behavior

**Files:**
- Modify: `cloud/shared/guest-intro-config.ts`
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] Change the shared fallback text and map both released creation-copy variants to the new fallback.
- [ ] Remove the plus glyph and make the secondary handler only call `markCurrentGuestIntroSeen()`.
- [ ] Extend the entry-loading predicate to the dismissed guest state while no accepted public community exists and loading is active.
- [ ] Run focused tests until green.

### Task 3: Verify and deliver

**Files:**
- Verify: `cloud/shared/guest-intro-config.ts`
- Verify: `miniprogram/src/pages/index/index.vue`

- [ ] Run `npm.cmd run type-check` and `npm.cmd run test:unit` from `miniprogram`.
- [ ] Run `npm.cmd run build:mp-weixin` from `miniprogram` and `npm.cmd run docs:check` from the repository root.
- [ ] Commit as AngryBird, push the feature branch, open a PR, follow exact-HEAD CI and Merge Queue to `MERGED`, then retire this worktree through the guarded command.
