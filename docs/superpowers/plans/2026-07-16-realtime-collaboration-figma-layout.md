# Realtime Collaboration Figma Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home-page realtime collaboration card use the Figma card proportions and full horizontal content width, without letting an optional corner ribbon compress every card.

**Architecture:** Keep the existing Vue/uni-app component and data flow. Adapt the Figma frame (`20017:1897`) into the existing SCSS: 24rpx page gutters, 32rpx card padding, 24rpx content gap, 96rpx icon, and 160rpx minimum height. Add a modifier only when a ribbon exists so ordinary cards retain symmetric padding while ribbon cards preserve their current text safe area.

**Tech Stack:** Vue 3 SFC, uni-app, SCSS/rpx design tokens, Node static regression tests, H5 visual validation.

---

### Task 1: Lock the Figma layout contract in a regression test

**Files:**
- Create: `scripts/test-home-collaboration-layout-static.mjs`

- [x] **Step 1: Replace the unconditional-right-padding assertion with the desired contract**

Assert that the template binds `group-card--with-ribbon` only for pinned/featured cards; ordinary `.group-card` uses `padding: 32rpx`, `min-height: 160rpx`, `gap: 24rpx`, and `border-radius: 24rpx`; the modifier alone uses `padding-right: 104rpx`; and the icon/image sizes are 96rpx and 70rpx by 56rpx.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node scripts/test-home-collaboration-layout-static.mjs`

Expected: FAIL because `.group-card` still has `padding: 18rpx 104rpx 18rpx 18rpx` and the modifier does not exist.

### Task 2: Implement the Figma dimensions without changing activity semantics

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Test: `scripts/test-home-collaboration-layout-static.mjs`

- [x] **Step 1: Add the ribbon-only class binding**

Bind `group-card--with-ribbon` to `item.isPinned || item.isFeatured` on the existing card; do not alter the title, metadata, navigation, or ribbon content.

- [x] **Step 2: Translate the Figma geometry into SCSS**

Set the section side margin to 24rpx. Set the base card to `box-sizing: border-box`, `min-height: 160rpx`, `padding: 32rpx`, `border-radius: 24rpx`, and `gap: 24rpx`. Put `padding-right: 104rpx` only on `.group-card--with-ribbon`. Set the icon to 96rpx square with a 24rpx radius, the car image to 70rpx by 56rpx, the text column to a vertical flex stack, and the metadata spacing to the Figma-equivalent 8rpx.

- [x] **Step 3: Run focused tests and verify GREEN**

Run: `node scripts/test-home-collaboration-layout-static.mjs`

Expected: PASS.

- [x] **Step 4: Run broader UI/static and build verification**

Run: `npm.cmd --workspace miniprogram run test:unit`, `node scripts/test-figma-mini-ui-static.mjs`, `node scripts/test-home-static.mjs`, and `npm.cmd --workspace miniprogram run build:h5`.

Result: the unit suite (428 Vitest + 112 Node tests), focused regression, sticky smoke, and H5 build passed. The two broad legacy static scripts fail on pre-existing main assertions for retired publish labels and the home icon contract before reaching this layout; those baseline failures are recorded rather than changed in this scoped PR. The DevTools mutation-oriented test was not run because browser-level compiled-CSS validation covered this layout without taking the shared validation lease.

- [x] **Step 5: Render the real H5 page and compare against Figma**

Use the existing H5 runtime without changing shared production data. Because the deterministic tenant has no realtime posts, inject a browser-memory-only card into the actual compiled home stylesheet and remove it by closing the page. Confirm the ordinary card measures 351x80px in a 375px viewport, has 12px page gutters, 16px symmetric padding, a 48px icon, a 12px content gap/radius, 259px body width, no shadow, and no horizontal overflow.

### Task 3: Publish and follow the PR to terminal state

**Files:**
- Modify: `docs/superpowers/plans/2026-07-16-realtime-collaboration-figma-layout.md` only to check completed steps if useful.

- [x] **Step 1: Review the diff and verification evidence**

Run `git diff --check`, inspect `git diff`, and confirm only the collaboration-card layout, its regression test, and this plan changed.

- [ ] **Step 2: Commit and push with the configured AngryBird identity**

Commit the scoped change, push `codex/realtime-collaboration-figma-layout`, and verify GitHub's exact PR head equals the pushed SHA.

- [ ] **Step 3: Open a ready PR and follow checks/review/merge queue**

Document the Figma node, test evidence, no deployment, no environment/data migration, and the corner-ribbon non-goal. Arm auto-merge only after required checks and reviews are satisfied, then monitor to `MERGED` or `CLOSED`.

- [ ] **Step 4: Retire this feature worktree after merge**

From `C:\Project\Claude\happyHome_public`, run `npm.cmd run worktree:retire -- X:\Users\86136\.codex\worktrees\realtime-collaboration-figma-layout\happyHome_public` and confirm the directory is removed.
