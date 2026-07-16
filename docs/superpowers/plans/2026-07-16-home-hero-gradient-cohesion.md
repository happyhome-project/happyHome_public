# Home Hero Gradient Cohesion Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-16 implementation sequence and is retained only for traceability.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, and automated tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home masthead, quote, search, and tabs read as one continuous cyan-mint field without changing sticky geometry.

**Architecture:** Define semantic hero color stops and one fixed-geometry highlight on `.phone-inner`. Compose separate masthead and body gradients from those shared tokens, meeting at the exact masthead height before the body continues into the quote and sticky surface.

**Tech Stack:** Vue 3, uni-app SCSS, Vitest, Playwright Chromium, WeChat and H5 builds.

---

### Task 1: Lock the shared color-field contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `scripts/test-h5-home-sticky-smoke.mjs`

- [ ] Replace the old single-gradient assertion with checks for `--home-hero-title-top`, `--home-hero-title-edge`, `--home-hero-quote`, and the existing sticky surface.
- [ ] Require `.home-shell` and `.home-topbar` to use the same fixed-size radial highlight.
- [ ] Require the shell gradient to reach the shared title-edge color at `calc(150rpx + env(safe-area-inset-top))` and the topbar to end at that same color.
- [ ] Extend H5 computed-style evidence to require both backgrounds to contain the shared title and quote palette while retaining every sticky coordinate assertion.
- [ ] Run `npx.cmd vitest run src/utils/__tests__/home-sticky-layout-static.test.ts` from `miniprogram`; expect failure against the independent topbar background.

### Task 2: Compose the continuous field

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] Add the three semantic hero color tokens and one fixed `300rpx × 240rpx` radial highlight token to `.phone-inner`.
- [ ] Compose `.home-shell` from the shared highlight and a vertical ramp that meets the masthead edge exactly, then continues through quote, sticky surface, and page background.
- [ ] Compose `.home-topbar` from the same highlight and title top-to-edge ramp.
- [ ] Leave all `98rpx` geometry, DOM, sticky positioning, z-index, typography, and interaction rules unchanged.
- [ ] Run the focused Vitest file and `node scripts/test-h5-home-sticky-smoke.mjs`; expect both to pass.

### Task 3: Verify and deliver

**Files:**
- Verify the changed page, tests, and historical delivery documents only.

- [ ] Run `npm.cmd --workspace miniprogram run test:unit`.
- [ ] Run `npm.cmd --workspace miniprogram run build:mp-weixin` and `npm.cmd --workspace miniprogram run build:h5`.
- [ ] Run `npm.cmd run test:governance`, `npm.cmd run docs:check`, and `git diff --check`.
- [ ] Capture the logged-in mobile H5 at the top and after both sticky stages; compare the title-to-quote seam and sticky adjacency.
- [ ] Commit as AngryBird, push the feature branch, create a PR, wait for exact-HEAD CI, enter Merge Queue, and follow to `MERGED` without deploying or releasing.
