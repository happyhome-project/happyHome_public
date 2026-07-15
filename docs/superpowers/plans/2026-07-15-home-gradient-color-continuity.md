# Home Gradient Color Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing mint hero gradient visibly present through the quote and transparent search surface before it transitions to the page background.

**Architecture:** Preserve the current DOM, sticky wrappers, gradient direction, radial layer, and geometry bridge. Change only the linear gradient's middle color stops, then lock those stops in static and rendered H5 contracts.

**Tech Stack:** Vue 3, uni-app SCSS, Vitest, Playwright Chromium, WeChat mini-program build.

---

### Task 1: Add the failing color-continuity contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `scripts/test-h5-home-sticky-smoke.mjs`

- [ ] **Step 1: Extend the static regression test**

Require `.home-shell` to contain `#caeee7 0%`, `#dcefe8 58%`, `#edf4ed 84%`, and `var(--hh-color-page) 100%` in its linear gradient while retaining the existing geometry checks.

- [ ] **Step 2: Verify RED**

Run from `miniprogram`:

```powershell
npx.cmd vitest run src/utils/__tests__/home-sticky-layout-static.test.ts
```

Expected: the new color-continuity assertion fails because the current middle stop is `#f1f3ee 58%` and no `84%` mint stop exists.

- [ ] **Step 3: Extend the rendered H5 smoke**

Read `.home-shell` computed `backgroundImage` and require the normalized colors `rgb(220, 239, 232)` and `rgb(237, 244, 237)`. Keep all existing geometry and sticky assertions.

### Task 2: Adjust only the existing gradient colors

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: Apply the minimal SCSS change**

Replace the existing linear gradient with:

```scss
linear-gradient(170deg, #caeee7 0%, #dcefe8 58%, #edf4ed 84%, var(--hh-color-page) 100%)
```

Do not modify the radial layer, padding, negative margin, search wrapper, sticky offsets, or DOM.

- [ ] **Step 2: Verify GREEN**

Run the focused Vitest file, build H5, and run `node scripts/test-h5-home-sticky-smoke.mjs` from the repository root. Expected: all pass.

- [ ] **Step 3: Perform mobile visual QA**

At a 390x844 viewport, verify the quote background remains mint, the transparent search wrapper reveals the same gradient, the search capsule stays white, and the transition reaches the page background only below the search.

### Task 3: Verify and merge through PR

**Files:**
- Verify only; no production deployment files.

- [ ] **Step 1: Run full proportional verification**

Run miniprogram type-check, complete unit tests, mp-weixin and H5 builds, H5 sticky smoke, release policy tests, docs checks, and `git diff --check`.

- [ ] **Step 2: Commit and push**

Commit as `AngryBird <48046333+angrybirddd@users.noreply.github.com>` on `codex/home-gradient-color-continuity`, then push the same branch.

- [ ] **Step 3: Complete the PR feedback loop**

Create a ready PR, monitor exact-head PR CI and review feedback, arm Merge Queue, and continue until GitHub reports terminal `MERGED` or `CLOSED`. Do not deploy or upload from the feature worktree.

