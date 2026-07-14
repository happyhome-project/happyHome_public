# Home Sticky Background Continuity Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-15 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, release UI checks, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a continuous homepage background around the quote, search, and tags without changing progressive sticky behavior.

**Architecture:** Keep the existing native sticky hierarchy and remove only the decorative surfaces added to its outer wrappers. Extend the existing static and real-browser contracts so transparent wrappers and sticky coordinates regress independently.

**Tech Stack:** Vue 3, uni-app, SCSS, Vitest, Playwright Chromium, WeChat mini-program build.

---

### Task 1: Lock the transparent-surface contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`
- Modify: `scripts/test-h5-home-sticky-smoke.mjs`

- [ ] **Step 1: Add failing static assertions**

Extract the `.home-search-sticky-shell` and `.section-tabs-sticky-shell` rule bodies and assert that neither contains `background:`, `box-shadow:`, or `backdrop-filter:`. Keep the existing position and offset assertions.

Assert that `.archive-topic-tabs` does not declare a background while retaining its horizontal scrolling and active-topic indicator.

- [ ] **Step 2: Run the focused Vitest file and verify RED**

Run: `npx.cmd vitest run miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`

Expected: FAIL because both wrappers currently define opaque backgrounds and shadows.

- [ ] **Step 3: Extend the H5 smoke**

Read `getComputedStyle()` for both wrappers before scrolling and assert transparent background colors, `boxShadow === 'none'`, and no backdrop filter, while retaining all existing sticky-coordinate assertions.

### Task 2: Remove only the regressed surfaces

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/components/ArchiveTopicTabs.vue`

- [ ] **Step 1: Make the minimal SCSS change**

Remove `background` and `box-shadow` from `.home-search-sticky-shell`. Remove `background`, `box-shadow`, and `backdrop-filter` from `.section-tabs-sticky-shell`. Remove the white background from `.archive-topic-tabs`. Do not change sticky positioning, offsets, dimensions, spacing, z-index, input styling, quote styling, or topic selection styling.

- [ ] **Step 2: Run focused tests and verify GREEN**

Run the focused Vitest file, `npm.cmd -w miniprogram run build:h5`, and `node scripts/test-h5-home-sticky-smoke.mjs`. All must pass.

- [ ] **Step 3: Commit the implementation**

Commit the test and SCSS change with the configured `AngryBird` identity.

### Task 3: Verify and deliver through PR

**Files:**
- Verify only; no production deployment files.

- [ ] **Step 1: Run proportional verification**

Run type-check, full unit tests, H5 build/smoke, mp-weixin build, relevant release UI policy checks, docs checks, and `git diff --check`.

- [ ] **Step 2: Perform visual QA**

Compare the supplied phone screenshots with the rendered initial homepage: the quote must remain on the hero gradient, search/tag outer wrappers must have no card surface, and the search input capsule must remain intact. Record any environment limitation separately from code/test results.

- [ ] **Step 3: Push, open PR, and monitor to terminal state**

Push `codex/home-sticky-background-continuity`, create a ready PR documenting that no cloud/admin/data changes exist, arm Merge Queue after exact-head CI passes, and monitor until `MERGED` or `CLOSED`.
