# Sticky Home Search and Tags Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-14 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, release UI checks, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home search bar stick below the fixed community masthead, then make section tags stick below the search bar as scrolling continues.

**Architecture:** Keep the existing fixed masthead and use two native CSS sticky siblings. Move search out of the bounded hero shell into a dedicated sticky wrapper, then offset the existing section-tabs sticky wrapper by the masthead plus the search wrapper height; no scroll-state JavaScript is added.

**Tech Stack:** Vue 3, uni-app, SCSS, Vitest static contracts, WeChat DevTools release UI automation.

---

### Task 1: Lock the sticky hierarchy contract

**Files:**
- Create: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: Write the failing static contract**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const page = readFileSync(resolve(__dirname, '../../pages/index/index.vue'), 'utf8')

describe('home progressive sticky navigation', () => {
  test('stacks search below masthead and tags below search', () => {
    expect(page).toContain('class="home-search-sticky-shell"')
    expect(page).toMatch(/\.home-search-sticky-shell\s*\{[^}]*position:\s*sticky;/s)
    expect(page).toMatch(/\.home-search-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\)\);/s)
    expect(page).toMatch(/\.section-tabs-sticky-shell\s*\{[^}]*top:\s*calc\(150rpx \+ env\(safe-area-inset-top\) \+ 138rpx\);/s)
    const shellClose = page.indexOf('</view>\n\n    <view class="home-search-sticky-shell"')
    const search = page.indexOf('class="home-search-sticky-shell"')
    const live = page.indexOf('<!-- Live strip')
    expect(shellClose).toBeGreaterThan(0)
    expect(search).toBeGreaterThan(shellClose)
    expect(search).toBeLessThan(live)
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- home-sticky-layout-static.test.ts`

Expected: FAIL because `.home-search-sticky-shell` does not exist and tags still use only the masthead offset.

- [ ] **Step 3: Implement the minimal sticky structure**

Move the existing `.home-search--primary` block immediately after `.home-shell` and wrap it as follows:

```vue
<view class="home-search-sticky-shell">
  <view class="home-search home-search--primary">
    <!-- preserve the existing search box, input, icon and action unchanged -->
  </view>
</view>
```

Add focused styles and replace `.home-shell .home-search*` selectors with `.home-search-sticky-shell .home-search*`:

```scss
.home-search-sticky-shell {
  box-sizing: border-box;
  position: sticky;
  top: calc(150rpx + env(safe-area-inset-top));
  z-index: $hh-z-sticky + 1;
  padding: 24rpx var(--hh-page-x);
  background: rgba(250, 250, 249, 0.98);
  box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.07);
}

.home-topbar {
  z-index: $hh-z-sticky + 2;
}

.home-search-sticky-shell .home-search {
  margin: 0;
}

.section-tabs-sticky-shell {
  top: calc(150rpx + env(safe-area-inset-top) + 138rpx);
  z-index: $hh-z-sticky;
}
```

Reduce `.home-shell` bottom padding so the detached search remains visually adjacent to the quote while preserving the existing hero background.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd --workspace miniprogram run test:unit -- home-sticky-layout-static.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the static contract and implementation**

```powershell
git add miniprogram/src/pages/index/index.vue miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts
git commit -m "feat(home): add progressive sticky search and tags"
```

### Task 2: Extend real WeChat layout evidence

**Files:**
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `scripts/lib/mp-release-ui-policy.test.mjs`

- [ ] **Step 1: Write the failing policy assertion**

Extend the policy test that inspects release UI source:

```js
assert.match(source, /query\.select\('\.home-search-sticky-shell'\)\.boundingClientRect\(\)/)
assert.match(source, /searchPinned/)
assert.match(source, /tagsPinned/)
```

- [ ] **Step 2: Run the focused policy test and verify RED**

Run: `node --test scripts/lib/mp-release-ui-policy.test.mjs`

Expected: FAIL because release UI evidence does not yet measure the search sticky wrapper or separate search/tags phases.

- [ ] **Step 3: Capture initial, search-pinned and tags-pinned layouts**

Update `captureHomeArchiveTabsLayout` to select `.home-search-sticky-shell`. In `verifyHomeArchiveTabs`, calculate two scroll targets from the initial search and tabs positions, capture `searchPinned` after the first target, then capture `tagsPinned` after the second target. Require:

```js
Math.abs(Number(searchPinned.search.top || 0) - Number(searchPinned.topbar.bottom || 0)) <= 8
Math.abs(Number(tagsPinned.search.top || 0) - Number(tagsPinned.topbar.bottom || 0)) <= 8
Math.abs(Number(tagsPinned.tabs[0].top || 0) - Number(tagsPinned.search.bottom || 0)) <= 8
```

Keep the existing archive-tab switch and scroll-restoration assertions, but evaluate them from the `tagsPinned` state.

- [ ] **Step 4: Run the focused policy test and verify GREEN**

Run: `node --test scripts/lib/mp-release-ui-policy.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the UI evidence update**

```powershell
git add scripts/test-mp-release-ui.mjs scripts/lib/mp-release-ui-policy.test.mjs
git commit -m "test(home): verify progressive sticky layout"
```

### Task 3: Full regression and handoff

**Files:**
- Verify only; modify production files only if a failing test exposes a defect in this feature.

- [ ] **Step 1: Run type and unit verification**

Run:

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
```

Expected: both exit 0.

- [ ] **Step 2: Build both targets**

Run:

```powershell
npm.cmd --workspace miniprogram run build:mp-weixin
npm.cmd --workspace miniprogram run build:h5
```

Expected: both builds complete successfully.

- [ ] **Step 3: Run static visual and release policy checks**

Run:

```powershell
node scripts/test-figma-mini-ui-static.mjs
npm.cmd run test:mp:replay-policy
git diff --check
```

Expected: all exit 0 and `git diff --check` prints nothing.

- [ ] **Step 4: Run real WeChat DevTools evidence when the validation lease is available**

Run: `npm.cmd run test:mp:release-ui`

Expected: `HH_RELEASE_HOME_ARCHIVE_TABS_STICKY` plus passing evidence with `searchPinned` and `tagsPinned`. If another owner holds the validation lease, report that exact external blocker rather than recovering or interrupting it.

- [ ] **Step 5: Review and commit any verification-only adjustment**

```powershell
git status --short --branch
git diff --check
```

Expected: only intentional feature files are committed; no generated build artifacts or unrelated files remain.
