# Profile Figma Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the mini-program profile and edit-profile states with Figma `0709_v2` while preserving existing behavior.

**Architecture:** Keep `pages/profile/index.vue` as the state owner. Switch only that page to custom navigation, render one platform-aware profile header, replace visual glyphs with local Figma-derived assets, and guard the contract with the existing static UI test. No API or cloud data shape changes.

**Tech Stack:** uni-app, Vue 3, TypeScript, scoped SCSS, Node static regression scripts, H5 and mp-weixin builds.

---

### Task 1: Lock the Figma profile contract

**Files:**
- Modify: `scripts/test-figma-mini-ui-static.mjs`
- Test: `scripts/test-figma-mini-ui-static.mjs`

- [x] **Step 1: Add failing assertions**

Assert that `pages/profile/index` uses `navigationStyle: custom`, the profile template contains a custom header and image assets, the shortcut cards contain decorative layers, the tool model uses icon paths, and the retired character glyph definitions are absent.

- [x] **Step 2: Verify the test fails for the missing implementation**

Run: `node scripts/test-figma-mini-ui-static.mjs`

Expected: FAIL on the first new profile assertion.

### Task 2: Persist the Figma assets

**Files:**
- Create: `miniprogram/src/static/profile/create-community.svg`
- Create: `miniprogram/src/static/profile/switch.svg`
- Create: `miniprogram/src/static/profile/edit-arrow.svg`
- Create: `miniprogram/src/static/profile/join-community-back.svg`
- Create: `miniprogram/src/static/profile/join-community-front.svg`
- Create: `miniprogram/src/static/profile/join-community-pin.svg`
- Create: `miniprogram/src/static/profile/shortcut-create-bg.svg`
- Create: `miniprogram/src/static/profile/shortcut-join-bg.svg`
- Create: `miniprogram/src/static/profile/favorite.svg`
- Create: `miniprogram/src/static/profile/like.svg`
- Create: `miniprogram/src/static/profile/archive.svg`
- Create: `miniprogram/src/static/profile/activity.svg`
- Create: `miniprogram/src/static/profile/posts.svg`
- Create: `miniprogram/src/static/profile/checkin.svg`
- Create: `miniprogram/src/static/profile/service.svg`

- [x] **Step 1: Download each MCP asset while the URLs are valid**

Use the exact asset mapping returned for Figma nodes `20001:14460` and `20036:4085`. Preserve the join icon's three exported vector layers and sanitize unsupported SVG CSS-variable/`foreignObject` constructs before storing the files locally.

- [x] **Step 2: Validate every file is an SVG and non-empty**

Run a PowerShell file signature/size check and fail if any asset is missing or contains an HTML error document.

### Task 3: Implement the custom profile shell

**Files:**
- Modify: `miniprogram/src/pages.json`
- Modify: `miniprogram/src/pages/profile/index.vue`

- [x] **Step 1: Make the profile page custom-navigation aware**

Set `navigationStyle` to `custom`; add a header containing only the app-owned `我的` title; reserve status/capsule space with safe-area CSS rather than drawing platform chrome.

- [x] **Step 2: Make the gradient continuous from the top**

Move the Figma gradient to the page root, remove the old top padding assumption from the native navigation layout, and retain bottom tabbar safe space.

### Task 4: Implement exact shortcut and tool visuals

**Files:**
- Modify: `miniprogram/src/pages/profile/index.vue`

- [x] **Step 1: Replace shortcut glyphs**

Render the local `<image>` asset for create, the three-layer vector composition for join, and the corresponding decorative background image as an absolutely positioned visual layer behind each icon.

- [x] **Step 2: Replace all seven tool glyphs**

Change `ProfileToolItem.icon` to `iconSrc`, render `<image class="profile-tool-icon-image">`, and keep the existing handler mapping unchanged.

- [x] **Step 3: Match Figma geometry**

Use two equal shortcut columns with a 12 px reference gap, a 76 px reference height, a four-column tool grid, 40 px icon slots, and 14/22 px labels.

### Task 5: Align the edit-profile state

**Files:**
- Modify: `miniprogram/src/pages/profile/index.vue`

- [x] **Step 1: Keep the current behavior contract**

Preserve `isEditingProfile`, `chooseAvatar`, nickname input, cancel, save, loading, and validation behavior.

- [x] **Step 2: Apply the profile visual language**

Render the editor as a focused white card within the same continuous gradient shell, with a centered avatar control, calm field surface, and equal-width actions sized to the Figma spacing/radius system.

### Task 6: Verify the implementation

**Files:**
- Test: `scripts/test-figma-mini-ui-static.mjs`
- Test: `miniprogram/src/pages/profile/index.vue`

- [x] **Step 1: Verify the static test turns green**

Run: `node scripts/test-figma-mini-ui-static.mjs`

Expected: PASS.

- [x] **Step 2: Run type and unit checks**

Run: `npm.cmd --workspace miniprogram run type-check`

Run: `npm.cmd --workspace miniprogram run test:unit`

- [x] **Step 3: Build both targets**

Run: `npm.cmd --workspace miniprogram run build:h5`

Run: `npm.cmd --workspace miniprogram run build:mp-weixin`

- [x] **Step 4: Run browser interaction and visual QA**

Open the H5 profile page at 402 x 874 and a narrower mobile viewport. Verify page identity, nonblank content, no framework overlay, console health, edit open/cancel, shortcut/tool response, and screenshot fidelity.

- [x] **Step 5: Review the final diff**

Confirm no backend/admin changes, no temporary Figma URLs, no fake system chrome, no character-icon regressions, and no unrelated file churn.
