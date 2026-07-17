# Profile Tool Availability Implementation Plan

> **Historical / point-in-time:** This 2026-07-17 plan records the implementation sequence for the approved profile-tool presentation change. Do not execute it as current work.
> **Current authority:** Use the [documentation authority map](../../README.md), current code, tests, and GitHub PR state. The approved point-in-time design is stored beside this plan under `docs/superpowers/specs/`.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unfinished profile tools visibly unavailable without changing the existing layout, and place the three working tools together on the second row.

**Architecture:** Add an optional `disabled` property to the existing local profile tool item model. The existing template uses that property for one state class and an interaction guard; scoped CSS applies the approved icon and label treatment.

**Tech Stack:** Vue 3, uni-app, scoped SCSS, Vitest static contract tests, H5 browser validation.

---

### Task 1: Lock the approved profile tool contract

**Files:**
- Create: `miniprogram/src/utils/__tests__/profile-tool-availability.test.ts`
- Modify: `miniprogram/src/pages/profile/index.vue`

- [ ] **Step 1: Write the failing test**

Create a source contract test that expects the exact order `favorite, like, archive, checkin, posts, activity, service`, expects only the first four items to set `disabled: true`, and expects the template to bind `profile-tool--disabled` and guard `handleProfileTool`.

- [ ] **Step 2: Run the test to verify RED**

Run `npm.cmd --workspace miniprogram exec -- vitest run src/utils/__tests__/profile-tool-availability.test.ts --pool=forks --maxWorkers=1`.

Expected: failure because the current order puts `activity` fourth and no disabled contract exists.

- [ ] **Step 3: Implement the minimal model and template change**

Add `disabled?: boolean`, reorder the array, mark the first four entries disabled, bind `profile-tool--disabled`, and return before dispatching an unavailable entry.

- [ ] **Step 4: Add the approved scoped visual state**

For `.profile-tool--disabled`, keep dimensions unchanged, set the icon to `filter: grayscale(1)` and `opacity: 0.38`, and set label color to `#a8a8a8`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the new test plus existing author-post-management and profile visual contract tests.

### Task 2: Render and validate the H5 result

**Files:**
- Verify: `miniprogram/src/pages/profile/index.vue`

- [ ] **Step 1: Run type-check and H5 build**

Run `npm.cmd --workspace miniprogram run type-check` and `npm.cmd --workspace miniprogram run build:h5`.

- [ ] **Step 2: Validate the mobile H5 page**

Open `/pages/profile/index` at 390 x 844, confirm the exact two-row order, compare the result to the approved preview, and verify unavailable clicks do not change the route while `我的活动` still opens its real route.

- [ ] **Step 3: Run repository policy checks**

Run `npm.cmd run docs:check` and `git diff --check` before commit.

- [ ] **Step 4: Commit and hand the branch to the PR feedback loop**

Commit as `AngryBird`, push `codex/profile-tools-coming-soon`, create the PR, verify GitHub exact HEAD, and follow required CI and Merge Queue to `MERGED` or `CLOSED`.
