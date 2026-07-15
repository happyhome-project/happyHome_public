# Home Hero Gradient Bridge Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-15 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, release UI checks, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing home hero gradient continuously beneath the transparent sticky search surface without changing progressive sticky behavior.

**Architecture:** Keep search as a sibling of `.home-shell` so native sticky remains unconstrained. Extend the hero background box by exactly the search surface height and cancel the added layout space with an equal negative margin.

**Tech Stack:** Vue 3, uni-app, SCSS, Vitest, Playwright Chromium, WeChat mini-program build.

---

### Task 1: Lock the gradient bridge contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `scripts/test-h5-home-sticky-smoke.mjs`

- [ ] **Step 1: Add the failing static contract**

Assert that `.home-shell` uses `138rpx` bottom padding and `-138rpx` bottom margin, while `.home-search-sticky-shell` retains `24rpx` vertical padding and its search box retains `90rpx` minimum height.

- [ ] **Step 2: Verify RED**

Run `npx.cmd vitest run src/utils/__tests__/home-sticky-layout-static.test.ts` from `miniprogram`.

Expected: FAIL because `.home-shell` currently ends immediately after the quote.

- [ ] **Step 3: Extend browser geometry assertions**

Capture `.home-shell` in the H5 smoke and require its bottom edge to match the initial search sticky wrapper bottom edge within the existing three-pixel tolerance. Keep the transparent-surface and progressive sticky assertions.

### Task 2: Extend the existing gradient surface

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: Apply the minimal SCSS change**

Change `.home-shell` from zero bottom padding to `138rpx` bottom padding and add `margin-bottom: -138rpx`. Do not edit the gradient, search wrapper, quote, sticky offsets, or DOM structure.

- [ ] **Step 2: Verify GREEN**

Run the focused Vitest file, build H5 with `npm.cmd -w miniprogram run build:h5`, and run `node scripts/test-h5-home-sticky-smoke.mjs` from the repository root.

- [ ] **Step 3: Commit**

Commit the tests, SCSS, design, and plan using the configured AngryBird identity.

### Task 3: Verify and merge through PR

**Files:**
- Verify only; no production deployment files.

- [ ] **Step 1: Run full proportional verification**

Run miniprogram type-check, complete unit tests, H5 build and smoke, mp-weixin build, release UI policy tests, docs checks, and `git diff --check`.

- [ ] **Step 2: Perform screenshot-based visual QA**

At a mobile viewport, verify that the hero gradient continues behind the transparent search wrapper, the white search capsule remains intact, and no spacing or sticky-coordinate regression appears.

- [ ] **Step 3: Push and monitor PR**

Push `codex/home-hero-gradient-bridge`, create a ready PR with mini-program-only release impact, wait for exact-head PR CI, arm Merge Queue, and monitor through terminal `MERGED` or `CLOSED` state.
