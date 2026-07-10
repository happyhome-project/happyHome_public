# Publish Experience Figma Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use exact Figma publish assets, unify date/draft controls, and group activity announcement title plus detail without changing backend widget contracts.

**Architecture:** Keep `AppTabBar.vue` and `WidgetEditor.vue` as shared rendering boundaries. Add a pure layout helper for semantic activity grouping, then let `pages/create/index.vue` consume the helper while preserving ungrouped widget order and fallback behavior.

**Tech Stack:** uni-app, Vue 3, TypeScript, SCSS, Vitest, Node static guards, Figma MCP exports.

---

### Task 1: Activity announcement layout contract

**Files:**
- Create: `miniprogram/src/utils/create-form-layout.ts`
- Create: `miniprogram/src/utils/__tests__/create-form-layout.test.ts`

- [ ] **Step 1: Write failing semantic-layout tests**

Cover detection of `活动公告`, title/body resolution, preservation of extra widgets, and fallback when either main widget is absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- --run miniprogram/src/utils/__tests__/create-form-layout.test.ts`

Expected: FAIL because `create-form-layout.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Export `resolveActivityAnnouncementMain(section, widgets)` returning either `{ titleWidget, bodyWidget, remainingWidgets }` or `null`. Match semantic labels/field keys and never mutate the input array.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run the command from Step 2. Expected: all new tests pass.

### Task 2: Figma asset and markup guard

**Files:**
- Create: `scripts/test-create-publish-ui-static.mjs`
- Modify: `miniprogram/src/components/AppTabBar.vue`
- Modify: `miniprogram/src/components/widgets/WidgetEditor.vue`
- Modify: `miniprogram/src/pages/create/index.vue`
- Replace: `miniprogram/src/static/publish-icons/family.svg`
- Replace: `miniprogram/src/static/publish-icons/trade.svg`
- Replace: `miniprogram/src/static/publish-icons/notice.svg`
- Replace: `miniprogram/src/static/publish-icons/lost.svg`
- Replace: `miniprogram/src/static/publish-icons/neighbor.svg`
- Replace: `miniprogram/src/static/publish-icons/car.svg`
- Create: `miniprogram/src/static/publish-icons/calendar.svg`
- Create: `miniprogram/src/static/publish-icons/save-draft.svg`

- [ ] **Step 1: Write the failing static UI guard**

Assert that the six publish icons carry their Figma source node markers, `WidgetEditor.vue` uses `calendar.svg` with `选择日期时间`, `create/index.vue` uses `save-draft.svg`, and the activity block consumes the pure layout helper.

- [ ] **Step 2: Run the guard and verify RED**

Run: `node scripts/test-create-publish-ui-static.mjs`

Expected: FAIL on missing Figma assets and activity block.

- [ ] **Step 3: Persist exact Figma assets**

Download/export the confirmed Figma node assets into the local static paths. Keep source node IDs in SVG comments so future design audits can identify provenance.

- [ ] **Step 4: Replace the draft glyph and add the shared calendar presentation**

Use an `<image>` for the draft action. Wrap `uni-datetime-picker` with the exact calendar asset, preserve its value conversion and click behavior, and style the shared field to match the reference.

- [ ] **Step 5: Add the activity main card**

Use `resolveActivityAnnouncementMain` in `createFormBlocks`. Render an `activityMain` block before the remaining widgets, with title and detail in one card and no backend content transformation.

- [ ] **Step 6: Re-run the static guard and focused unit test**

Run:

```powershell
node scripts/test-create-publish-ui-static.mjs
npm.cmd --workspace miniprogram run test:unit -- --run miniprogram/src/utils/__tests__/create-form-layout.test.ts
```

Expected: both commands pass.

### Task 3: Integration and rendered QA

**Files:**
- Modify only files from Tasks 1 and 2 if QA finds a verified regression.

- [ ] **Step 1: Run source checks**

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
node scripts/test-figma-mini-ui-static.mjs
node scripts/test-create-publish-ui-static.mjs
```

Expected: zero failures.

- [ ] **Step 2: Build both targets**

```powershell
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: both builds exit 0.

- [ ] **Step 3: H5 interaction and visual QA**

Run the H5 server and verify at a mobile viewport:

- Home plus button opens the publish sheet and exact icons render.
- A datetime field shows the calendar asset and opens the picker.
- The activity announcement form shows one title/detail card followed by time, place, and extra widgets.
- Draft action uses the save icon and still stores the draft.
- Guide publishing remains visually and functionally unchanged apart from shared date/draft controls.

- [ ] **Step 4: Review the final diff**

Run `git diff --check`, `git diff --stat`, and inspect every changed file for accidental schema, navigation, or unrelated visual changes.

