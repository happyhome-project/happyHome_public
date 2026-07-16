# Carpool Card Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a deterministic vehicle SVG for home carpool cards so unsupported Emoji fonts cannot produce a missing-glyph box.

**Architecture:** Extend the home live-item view model with an optional asset source derived from the protected collaboration system key. Render that asset inside the existing icon container while preserving the current text glyph fallback for non-carpool templates.

**Tech Stack:** uni-app, Vue 3, TypeScript, Vitest/static source assertions, SCSS

---

### Task 1: Add a failing carpool icon regression test

**Files:**
- Create: `miniprogram/src/utils/__tests__/home-collaboration-icon.test.ts`
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: Write the failing test**

Assert that the home page defines a `carpool` system-key-to-asset mapping for `/static/publish-icons/car.svg`, exposes `iconSrc` on live items, and renders an image branch with a text fallback.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/home-collaboration-icon.test.ts`

Expected: FAIL because `iconSrc` and the carpool SVG mapping are absent.

- [ ] **Step 3: Implement the minimal rendering change**

Add `iconSrc?: string` to `LiveItem`, derive it only when `section.systemKey === 'carpool'`, render `<image v-if="item.iconSrc">`, and retain `<text v-else>{{ item.ic }}</text>`.

- [ ] **Step 4: Add image sizing inside the existing icon container**

Size the image without changing the container dimensions, background, spacing, or card layout.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/home-collaboration-icon.test.ts src/utils/__tests__/section-icon.test.ts`

Expected: PASS with zero failed tests.

### Task 2: Verify and publish

**Files:**
- Verify: `miniprogram/src/pages/index/index.vue`
- Verify: `miniprogram/src/utils/__tests__/home-collaboration-icon.test.ts`

- [ ] **Step 1: Run repository checks**

Run the focused tests, mini-program build, static UI checks, and `git diff --check`.

- [ ] **Step 2: Verify rendered behavior**

Launch the local H5 surface using the repository launcher and inspect the carpool icon container at a mobile viewport. If shared DevTools validation is safely available, run the relevant mini-program release UI validation as well.

- [ ] **Step 3: Commit and push**

Commit only the design, plan, test, and home-page change using the configured AngryBird identity, then push `codex/carpool-card-icon`.

- [ ] **Step 4: Create and follow the PR**

Create a PR documenting the production-data evidence, tests, deployment impact (`none`), environment changes (`none`), migrations (`none`), acceptance steps, and the remaining platform-rendering risk. Confirm the exact remote HEAD, follow required CI/review comments, arm Merge Queue when ready, and continue until `MERGED` or `CLOSED`.
