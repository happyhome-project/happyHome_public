# Figma 0710 Visual Alignment Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-13 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), the Figma `社区资源共享_小程序_0710` source, current checked-in styles, code, and tests. Search remains explicitly out of scope for this delivery.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the approved home and profile surfaces with Figma `社区资源共享_小程序_0710` without changing search or business behavior.

**Architecture:** Keep visual changes inside the existing Vue pages. Put rich-text-to-plain-text conversion in the shared widget formatter so home and section summaries agree, keep developer tools behind an explicit local opt-in, and expose build identity as non-visual page metadata for release gates.

**Tech Stack:** Vue 3, uni-app, TypeScript, SCSS, Vitest, Node static-policy scripts, WeChat DevTools automation.

---

### Task 1: Lock the home visual contracts with failing tests

**Files:**
- Modify: `miniprogram/src/utils/__tests__/widget.test.ts`
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`
- Modify: `scripts/test-home-static.mjs`

- [ ] **Step 1: Add rich-text plain-title assertions**

Add to `widget.test.ts`:

```ts
expect(formatWidgetValue('<p>第一段</p><p>第二段 &amp; 补充</p>', 'rich_text'))
  .toBe('第一段 第二段 & 补充')
```

Create a section/post whose only usable title field is `rich_text`, then assert `getPostHomeTitle()` returns the same plain text and contains no `<...>` tag.

- [ ] **Step 2: Add text-only tab and narrow masthead assertions**

In `community-pages-figma.test.ts`, assert:

```ts
expect(code).not.toContain('class="section-tab-icon"')
expect(code).not.toContain('{{ g.icon }}')
expect(code).toMatch(/\.community-identity\s*\{[^}]*flex:\s*1 1 0[^}]*overflow:\s*hidden/s)
expect(code).toMatch(/\.community-title\s*\{[^}]*flex:\s*1 1 0[^}]*text-overflow:\s*ellipsis/s)
expect(code).toMatch(/\.community-switch\s*\{[^}]*flex:\s*0 0 auto/s)
```

Update `test-home-static.mjs` to require text-only tabs instead of requiring `.section-tab-icon`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/widget.test.ts src/utils/__tests__/community-pages-figma.test.ts
node scripts/test-home-static.mjs
```

Expected: failures for raw rich text, rendered tab icons, and the current masthead flex rules.

### Task 2: Implement the home corrections

**Files:**
- Modify: `miniprogram/src/utils/widget.ts`
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: Normalize rich text in the shared formatter**

Add a small internal `htmlToPlainText()` helper that removes script/style content, turns block boundaries and `<br>` into spaces, strips tags, decodes common entities, and collapses whitespace. Use it only for `widgetType === 'rich_text'` inside `formatWidgetValue()`.

- [ ] **Step 2: Remove icon markup from both home tab rows**

Delete both `.section-tab-icon` template blocks and the unused archive-group `icon` property. Keep `resolveSectionIconGlyph()` where live/notice content still consumes it.

- [ ] **Step 3: Make the masthead reserve the switch control**

Apply the approved flex contract:

```scss
.community-identity { flex: 1 1 0; min-width: 0; overflow: hidden; }
.community-title { display: block; flex: 1 1 0; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.community-switch { flex: 0 0 auto; }
```

Remove `.section-tab-icon` styling and keep the tab row no-wrap and horizontally scrollable.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 commands. Expected: all focused tests and `test-home-static.mjs` pass.

### Task 3: Lock the profile visual contracts with failing tests

**Files:**
- Modify: `miniprogram/src/utils/__tests__/profile-debug-visibility.test.ts`
- Modify: `miniprogram/src/utils/__tests__/profile-web-auth.test.ts`
- Modify: `miniprogram/src/utils/__tests__/home-diagnostics-static.test.ts`
- Modify: `scripts/test-h5-profile-smoke.mjs`
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `scripts/lib/mp-release-ui-policy.mjs`

- [ ] **Step 1: Assert default profile has no visible developer/build UI**

Require absence of `profile-release-id`, default `DEV 登录`, and the unguarded `showHomeDiagnostics && !isEditingProfile` panel. Require a root `data-build-version` binding instead.

- [ ] **Step 2: Assert logout is outside the identity header**

Extract the logged-in identity template and assert it contains `profile-edit-link` but not `profile-web-logout`. Assert an H5-only bottom action still exposes `data-testid="h5-logout"` and calls `userStore.logout()`.

- [ ] **Step 3: Change smoke/release expectations to machine metadata**

Update H5 and native release smoke code to read `.profile-page`'s `data-build-version` attribute and assert the version is not present in page text.

- [ ] **Step 4: Run focused profile tests and verify RED**

Run:

```powershell
npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/profile-debug-visibility.test.ts src/utils/__tests__/profile-web-auth.test.ts src/utils/__tests__/home-diagnostics-static.test.ts
npm.cmd run test:mp:replay-policy
```

Expected: failures for visible version/dev/diagnostics and the stacked logout action.

### Task 4: Implement the profile corrections

**Files:**
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: policy/docs files from Task 3 only where they encode visible-version behavior

- [ ] **Step 1: Restore Figma identity layout**

Remove the identity-header H5 logout link. Add an H5-only bottom `退出登录` action after `退出当前社区`, calling the unchanged `webLogoutLock` flow.

- [ ] **Step 2: Hide development tools by default**

Create a computed explicit developer-tools gate that requires develop/trial environment plus local storage opt-in `hh-profile-developer-tools === '1'`. Gate DEV login and Home diagnostics with it.

- [ ] **Step 3: Move build identity to non-visual metadata**

Bind `:data-build-version="releaseVersion"` on `.profile-page`, remove visible version markup and obsolete styles, and update smoke/release policy descriptions.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 3 commands. Expected: all focused tests and release-policy tests pass.

### Task 5: Full validation and visual QA

**Files:**
- Create: `design-qa.md`
- Create ignored evidence under: `output/visual-qa/figma-0710/`

- [ ] **Step 1: Run code validation**

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
node scripts/test-home-static.mjs
node scripts/test-figma-mini-ui-static.mjs
```

Expected: all commands pass. If `test-figma-mini-ui-static.mjs` still contains stale pre-task expectations, update only those expectations to current production keys and 0710 contracts, then rerun.

- [ ] **Step 2: Capture matching H5 states**

At 402 x 874, capture home with a long community name, logged-in profile, and logged-out profile. Confirm tabs are text-only, switch remains visible, no raw tags appear, no debug/version panel appears, and logout remains available at the bottom.

- [ ] **Step 3: Run native DevTools validation**

```powershell
npm.cmd run validation:lease:status
$env:HH_CAPTURE_RELEASE_SCREENSHOT='1'
npm.cmd run test:mp:release-ui
```

Expected markers: cold-start home nonempty, home images rendered, detail nonempty, build identity verified through metadata, and profile login clean.

- [ ] **Step 4: Complete design QA**

Put each Figma 0710 reference and matching implementation screenshot into the same comparison image. Record typography, spacing, colors, assets, and copy checks in `design-qa.md`. Fix every P0/P1/P2 mismatch and repeat until `final result: passed`.

### Task 6: Deliver through the protected PR workflow

**Files:**
- Modify only task-scoped files and docs above.

- [ ] **Step 1: Verify scope and commit**

Run `git diff --check`, inspect `git diff --stat`, verify author identity, and commit with `AngryBird <48046333+angrybirddd@users.noreply.github.com>`.

- [ ] **Step 2: Push and open PR**

Push `codex/figma-visual-audit`, open a non-draft PR documenting Figma 0710 source, tests, no deployment, no environment/data changes, visual evidence, and known limits.

- [ ] **Step 3: Follow CI/review/merge queue to terminal state**

Track the exact PR HEAD, address actionable feedback, require `pr-ci / offline`, arm Merge Queue with `gh pr merge <N> --auto --merge`, and continue until `MERGED` or `CLOSED`.
