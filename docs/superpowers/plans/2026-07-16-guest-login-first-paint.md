# Guest Login First Paint Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-16 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the signed-out login introduction the first visible cold-start state while home data loads concurrently, then focus WeChat's nickname field immediately after avatar selection.

**Architecture:** Seed the home page with the compiled guest-intro default before asynchronous bootstrap begins. Add an explicit authenticated-home-pending render state so successful login never reveals an uninitialized empty page. Keep the existing bootstrap and login APIs unchanged.

**Tech Stack:** Vue 3 setup script, uni-app/WeChat mini-program lifecycle, Pinia stores, Vitest, static source-contract tests.

---

### Task 1: Lock the first-paint and nickname-focus behavior with failing tests

**Files:**
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`
- Modify: `miniprogram/src/utils/__tests__/pull-down-refresh.test.ts`

- [ ] Add assertions that the guest intro is initialized from `DEFAULT_GUEST_INTRO_CONFIG`, its initial visibility is computed synchronously for signed-out users, and `initializeHome()` still starts bootstrap independently.
- [ ] Add assertions that avatar selection schedules nickname focus and that the nickname input binds its `focus` state.
- [ ] Add assertions that signed-in pending home data selects a dedicated entry skeleton instead of normal empty content.
- [ ] Run `npx.cmd vitest run src/utils/__tests__/community-pages-figma.test.ts src/utils/__tests__/pull-down-refresh.test.ts --pool=forks --maxWorkers=1` from `miniprogram`; expect the new assertions to fail for missing first-paint initialization, focus binding, and pending skeleton.

### Task 2: Implement the startup state transition

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] Import `DEFAULT_GUEST_INTRO_CONFIG` and initialize the guest config and mask synchronously when the local store is signed out.
- [ ] Preserve immediate `initializeHome()` execution so guest bootstrap begins on startup, not on a login click.
- [ ] Track whether the first usable home snapshot has resolved and compute an authenticated pending state.
- [ ] Wrap normal home content in the ready state and render a minimal branded entry skeleton while authenticated data is pending.
- [ ] Ensure refresh failure releases the pending skeleton into the existing error/retry UI.
- [ ] Run the focused tests and expect them to pass.

### Task 3: Focus the WeChat nickname selector after avatar choice

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] Add a reactive nickname-focus flag and bind it to the `type="nickname"` input.
- [ ] After a valid avatar chooser result, switch to nickname mode and set focus after the DOM update; do not call any keyboard API.
- [ ] Clear focus when cancelling, submitting, hiding, or unmounting the login flow.
- [ ] Run the focused tests and expect them to pass.

### Task 4: Verify the complete mini-program change

**Files:**
- Verify: `miniprogram/src/pages/index/index.vue`
- Verify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`
- Verify: `miniprogram/src/utils/__tests__/pull-down-refresh.test.ts`

- [ ] Run `npm.cmd run type-check` from `miniprogram`; expect exit 0.
- [ ] Run the full affected unit suite from `miniprogram`; expect zero failures.
- [ ] Run `npm.cmd run build:mp-weixin` from `miniprogram`; expect exit 0.
- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Check `npm.cmd run validation:lease:status`. If free, validate a signed-out cold start and avatar-to-nickname transition in WeChat DevTools without creating cloud fixtures.
- [ ] Commit with the configured `AngryBird <48046333+angrybirddd@users.noreply.github.com>` identity, push the feature branch, open a PR, and follow its exact HEAD through PR CI and Merge Queue to `MERGED`.
