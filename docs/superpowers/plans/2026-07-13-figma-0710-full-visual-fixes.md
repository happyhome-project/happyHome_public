# Figma 0710 Full Visual Fixes Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-13 full-page visual correction delivery.
> **Current authority:** Use the [documentation authority map](../../README.md), approved design specification `docs/superpowers/specs/2026-07-13-figma-0710-full-visual-fixes-design.md`, current Figma 0710 source, checked-in code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the confirmed Figma 0710 visual mismatches for home empty state, detail/notice hierarchy, publish surfaces, and profile editing without changing business behavior.

**Architecture:** Keep corrections inside existing Vue pages/components and shared presentation helpers. Export exact Figma assets into local static files, preserve current routes and stores, and use static/unit contracts plus matching runtime screenshots to prevent visual regressions.

**Tech Stack:** Vue 3, uni-app, TypeScript, SCSS, Vitest, Node static-policy scripts, Figma MCP, H5 runtime, WeChat DevTools.

---

### Task 1: Add the Figma home empty state

**Files:**
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`
- Modify: `miniprogram/src/pages/index/index.vue`
- Create: `miniprogram/src/static/home-empty.png`

- [ ] **Step 1: Write the failing empty-state contract**

Add assertions that require `home-empty-state`, the exact title/description/action copy, `/static/home-empty.png`, a content/loading gate, and an action calling the existing create/publish entry. The test must reject CSS-drawn illustration markup.

```ts
expect(code).toContain('class="home-empty-state"')
expect(code).toContain('src="/static/home-empty.png"')
expect(code).toContain('暂无社区内容')
expect(code).toContain('这里还没有帖子，成为第一个分享的人吧')
expect(code).toContain('去发布帖子')
expect(code).not.toContain('class="home-empty-illustration-shape"')
```

- [ ] **Step 2: Verify RED**

Run from `miniprogram`:

```powershell
npx.cmd vitest run src/utils/__tests__/community-pages-figma.test.ts
```

Expected: fail because the empty-state markup and asset do not exist.

- [ ] **Step 3: Export the exact Figma artwork**

Export Figma node `20030:1665` from file `a0yB3Ht7e3LZ1FguQdft7L` as a transparent PNG into `miniprogram/src/static/home-empty.png`. Do not recreate it with CSS, text glyphs, or hand-authored SVG.

- [ ] **Step 4: Implement the gated state and action**

Add a computed state that is true only after loading completes, a current community and selected section exist, and the selected section's rendered collection is empty. Render the Figma block in the normal content slot. The action must reuse the existing create intent/navigation path rather than write data.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 command and `node scripts/test-home-static.mjs` from the repository root. Expected: both pass.

### Task 2: Align default and notice detail hierarchy

**Files:**
- Modify: `scripts/test-default-detail-static.mjs`
- Modify: `miniprogram/src/components/DefaultDetailView.vue`
- Modify: `miniprogram/src/pages/notice/index.vue`
- Create: `miniprogram/src/utils/__tests__/notice-detail-figma.test.ts`

- [ ] **Step 1: Write failing hierarchy tests**

Require the default detail title to use the post-title helper before metadata, require author/date metadata, and forbid a section name from being the primary heading. Require the notice route to render `公告详情`, an author/date row, then body content, and reject the decorative `notice-card`/accent strip.

```ts
expect(defaultDetail).toMatch(/detail-title[\s\S]*detail-author-row[\s\S]*detail-body/)
expect(notice).toContain('公告详情')
expect(notice).toMatch(/notice-author-row[\s\S]*notice-body/)
expect(notice).not.toContain('class="notice-card"')
```

- [ ] **Step 2: Verify RED**

```powershell
node scripts/test-default-detail-static.mjs
npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/notice-detail-figma.test.ts
```

Expected: fail on the current section-first default hierarchy and decorative notice card.

- [ ] **Step 3: Implement the minimal hierarchy changes**

In `DefaultDetailView.vue`, keep widgets and metadata semantics unchanged but render the post title first, followed by author/date and secondary tags. In `notice/index.vue`, preserve loading/error logic and route parameters while replacing only the loaded-state markup/styles with the Figma white-page hierarchy.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 commands plus `node scripts/test-figma-mini-ui-static.mjs`. Expected: all pass.

### Task 3: Correct publish sheet, navigation, and location assets

**Files:**
- Modify: `scripts/test-create-publish-ui-static.mjs`
- Modify: `miniprogram/src/components/AppTabBar.vue`
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/components/widgets/WidgetEditor.vue`
- Create: `miniprogram/src/static/publish-icons/generic.svg`
- Create: `miniprogram/src/static/publish-icons/location.svg`
- Create: `miniprogram/src/static/publish-icons/location-marker.svg`
- Create: `miniprogram/src/static/publish-icons/location-map.png`

- [ ] **Step 1: Write failing publish contracts**

Require content-driven sheet height without `min-height: 648rpx`, a stable generic fallback independent of array index, one navigation back control, image-backed location icons/map, and absence of `⌖`, `●`, `location-map-ghost`, and repeating-gradient map art.

```js
assert(!tabbar.includes('min-height: 648rpx'))
assert(tabbar.includes("/static/publish-icons/generic.svg"))
assert(!tabbar.includes('index % tones.length'))
assert(!create.includes('class="create-back"'))
assert(widget.includes('/static/publish-icons/location.svg'))
assert(widget.includes('/static/publish-icons/location-map.png'))
assert(!widget.includes('⌖') && !widget.includes('location-map-ghost'))
```

- [ ] **Step 2: Verify RED**

```powershell
node scripts/test-create-publish-ui-static.mjs
```

Expected: fail on all current mismatches.

- [ ] **Step 3: Add real assets**

Reuse checked-in Figma publish icon styling. Export the location/map visual from the Figma 0710 publish component frames into the declared static files. Do not hand-draw replacements. The neutral fallback icon must follow the existing publish icon family and must not encode a random business category.

- [ ] **Step 4: Implement the sheet and mapping corrections**

Remove the fixed minimum height. Keep four columns, use row-count-driven content height, retain safe-area padding, and reduce the close-button top gap to the Figma rhythm. Change `resolvePublishMeta()` to accept only the section name and return the neutral generic icon for unknown names.

- [ ] **Step 5: Remove the duplicate in-content back control**

Delete `.create-back` markup and styles. Preserve section selection when no section intent exists and preserve native navigation behavior when a section intent exists.

- [ ] **Step 6: Replace location glyph/CSS art**

Use `<image mode="aspectFit">` for the field pin and marker, and an `<image mode="aspectFill">` for the map background. Keep `chooseLocation`, `clearLocation`, values, and events unchanged.

- [ ] **Step 7: Verify GREEN**

Run the Step 2 command, the widget unit tests, and `node scripts/test-figma-mini-ui-static.mjs`. Expected: all pass.

### Task 4: Convert profile editing to the Figma bottom sheet

**Files:**
- Modify: `miniprogram/src/utils/__tests__/profile-web-auth.test.ts`
- Create: `miniprogram/src/utils/__tests__/profile-edit-sheet.test.ts`
- Modify: `miniprogram/src/pages/profile/index.vue`

- [ ] **Step 1: Write the failing bottom-sheet contract**

Require normal profile content to remain rendered during edit, a mask and bottom sheet to be conditionally mounted, the existing avatar/nickname/save/cancel behaviors inside the sheet, and removal of the page-level `user-card--form` edit replacement.

```ts
expect(code).toContain('class="profile-edit-mask"')
expect(code).toContain('class="profile-edit-sheet"')
expect(code).toMatch(/profile-edit-mask[\s\S]*profile-edit-sheet/)
expect(code).not.toContain("'user-card--form': isEditingProfile || showManualLoginForm")
expect(code).toContain('@tap="cancelEditProfile"')
expect(code).toContain('@tap="saveProfile"')
```

- [ ] **Step 2: Verify RED**

```powershell
npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/profile-edit-sheet.test.ts src/utils/__tests__/profile-web-auth.test.ts
```

Expected: fail because editing currently replaces the identity card in page flow.

- [ ] **Step 3: Implement the overlay without changing behavior**

Keep the logged-in identity, shortcuts, tools, and AppTabBar rendered. Mount the edit mask after page content, prevent mask taps from leaking to the page, and place the existing avatar chooser, nickname input, fallback message, cancel, and save controls in the sheet. Reuse `startEditProfile`, `cancelEditProfile`, and `saveProfile`.

- [ ] **Step 4: Apply Figma geometry**

Use a fixed mask above AppTabBar, `rgba(0,0,0,0.55)`, a bottom-aligned white sheet with 32rpx top radii, centered title/avatar, one nickname row, two equal action buttons, and safe-area bottom padding.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 commands and the existing profile tests. Expected: all pass.

### Task 5: Full validation and visual QA

**Files:**
- Modify: `design-qa.md`
- Create ignored evidence under: `output/figma-0710-full-fixes/`

- [ ] **Step 1: Run repository validation**

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
node scripts/test-home-static.mjs
node scripts/test-default-detail-static.mjs
node scripts/test-create-publish-ui-static.mjs
node scripts/test-figma-mini-ui-static.mjs
npm.cmd run docs:check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Capture corrected H5 states**

At 402 x 874 capture home empty, default text detail, notice detail, one-row and two-row publish sheets, publish form header, selected/unselected location, and profile edit. Use isolated local fixtures only; do not write shared cloud data.

- [ ] **Step 3: Validate unreproduced risk states**

Use the machine validation lease before native DevTools. Capture refresh, sticky home, guide detail, and tagged detail. If they match Figma, record them as passed without code changes. If a mismatch is reproduced, add a new failing test and minimal fix before continuing.

- [ ] **Step 4: Build comparison evidence**

Place each Figma reference and corrected runtime screenshot in the same image. Update `design-qa.md` with the exact evidence paths and classify any remaining differences by severity.

### Task 6: Review and protected PR delivery

**Files:**
- Modify only files already listed by Tasks 1-5.

- [ ] **Step 1: Run spec-compliance and code-quality review**

Review each implementation task against the approved design before reviewing code quality. Fix every Critical/Important issue and rerun focused tests.

- [ ] **Step 2: Verify author and scope, then commit**

```powershell
git config --global user.name
git config --global user.email
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Expected author: `AngryBird <48046333+angrybirddd@users.noreply.github.com>`.

- [ ] **Step 3: Push, open PR, and follow Merge Queue**

Push `codex/figma-0710-full-audit`, open a non-draft PR with tests/evidence and explicit no-deploy/no-shared-data statements, monitor exact-HEAD checks/reviews/comments, arm Merge Queue with `gh pr merge <N> --auto --merge`, and continue until `MERGED` or `CLOSED`.
