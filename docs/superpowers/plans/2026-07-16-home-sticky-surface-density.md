# Home Sticky Surface Density Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-16 implementation sequence and is retained only for traceability.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, and automated tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the quote, search wrapper, and tabs wrapper to one pale cyan surface while reducing only the two wrapper heights and preserving progressive sticky behavior.

**Architecture:** Keep the production DOM and native CSS sticky hierarchy. Introduce one inherited surface-color variable, derive the tabs offset from the new `98rpx` search wrapper height, and tighten only the wrapper and tabs-inner vertical padding.

**Tech Stack:** Vue 3, uni-app SCSS, Vitest, Playwright Chromium, WeChat and H5 builds.

---

### Task 1: Lock the visual and sticky geometry contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `scripts/test-h5-home-sticky-smoke.mjs`

- [ ] Replace the transparent-wrapper assertions with a shared `#e6f4f6` surface assertion while retaining the no-shadow and no-backdrop-filter checks.
- [ ] Require the search wrapper, hero bridge, and tabs top offset to use `98rpx` rather than `138rpx`.
- [ ] Read `ArchiveTopicTabs.vue` in the static test and require `4rpx` top padding, `18rpx` bottom padding, and the existing `28rpx / 40rpx` text geometry.
- [ ] Extend the H5 smoke to compare search and tabs computed backgrounds and check the compact search height while retaining all existing pin/release coordinate assertions.
- [ ] Run `npx.cmd vitest run src/utils/__tests__/home-sticky-layout-static.test.ts` from `miniprogram` and confirm failure against the old CSS.

### Task 2: Implement the shared surface and compact heights

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/components/ArchiveTopicTabs.vue`

- [ ] Define `--home-sticky-surface: #e6f4f6` on `.phone-inner`.
- [ ] Change the hero gradient to the sampled `#d5f4f3`, `#def4f4`, and shared surface sequence and soften the radial highlight.
- [ ] Set search padding to `4rpx`, hero bridge to `98rpx`, tabs sticky offset to `98rpx`, and give search/tabs wrappers the shared surface background.
- [ ] Change only the topic-tabs inner top padding from `20rpx` to `4rpx`; keep bottom padding, font size, line height, gap, and underline rules intact.
- [ ] Run the focused static test and `node scripts/test-h5-home-sticky-smoke.mjs`; expect both to pass.

### Task 3: Verify and deliver

**Files:**
- Verify all changed files only; no additional production files.

- [ ] Run `npm.cmd --workspace miniprogram run test:unit`.
- [ ] Run `npm.cmd --workspace miniprogram run build:mp-weixin` and `npm.cmd --workspace miniprogram run build:h5`.
- [ ] Run `npm.cmd run test:governance`, `npm.cmd run docs:check`, and `git diff --check`.
- [ ] Review the diff to confirm no sticky DOM, event, `position`, or z-index changes.
- [ ] Commit as AngryBird, push the feature branch, create a PR, wait for exact-HEAD CI, then enter Merge Queue and follow to `MERGED`.
