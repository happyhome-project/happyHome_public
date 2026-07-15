# Home Visible Tabs Sticky Regression Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-15 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current checked-in code, release UI checks, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the second-stage sticky behavior on the single user-visible `ArchiveTopicTabs` control and make regressions fail against the production DOM.

**Architecture:** Keep native CSS sticky positioning at the home-page level. Wrap the visible topic component in the existing sticky shell inside the long archive parent, remove the hidden legacy tabs copy, and change the H5 smoke from a synthetic tabs fixture to the real rendered component. The H5 command builds current source before reading `dist`, while the WeChat release gate queries the visible custom components instead of removed legacy classes.

**Tech Stack:** Vue 3, uni-app, TypeScript, SCSS, Vitest, Playwright Chromium, WeChat mini-program build.

---

### Task 1: Make tests observe the visible Tabs

**Files:**
- Modify: `miniprogram/src/utils/__tests__/home-sticky-layout-static.test.ts`
- Modify: `scripts/test-h5-home-sticky-smoke.mjs`
- Modify: `scripts/test-home-tabs-scroll-static.mjs`
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `scripts/lib/mp-release-ui-policy.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the failing static production-DOM contract**

Add a template-only source slice and assert that the visible component is inside the only sticky shell:

```ts
const template = page.slice(0, page.indexOf('<script'))

expect(template).toMatch(
  /<view class="archive-topic-shell">\s*<view class="section-tabs-sticky-shell section-tabs-sticky-shell--archive">\s*<ArchiveTopicTabs/,
)
expect(template).not.toMatch(/v-show="false"[^>]*class="section-tabs-sticky-shell"/)
expect(template.match(/class="section-tabs-sticky-shell(?: [^"]*)?"/g)).toHaveLength(1)
```

- [ ] **Step 2: Run the focused static test and verify RED**

Run from `miniprogram`:

```powershell
npx.cmd vitest run src/utils/__tests__/home-sticky-layout-static.test.ts
```

Expected: FAIL because `ArchiveTopicTabs` is currently outside the sticky shell and the only sticky shell is hidden legacy markup.

- [ ] **Step 3: Replace the synthetic H5 Tabs fixture**

In `scripts/test-h5-home-sticky-smoke.mjs`:

- Require the rendered `.archive-topic-shell`, `.section-tabs-sticky-shell`, and `.archive-topic-tabs` anchors.
- Insert only a neutral vertical spacer after search to represent optional activity/schedule content.
- Set a bounded `minHeight` on `.archive-topic-shell` so the real sticky child has a long containing block.
- Never create a `.section-tabs-sticky-shell` or tab markup in the test.
- Measure both the real sticky shell and the real topic component; require their top edges to match after the second threshold.

- [ ] **Step 4: Make the smoke own its current H5 build and verify the real-DOM smoke is RED**

```powershell
npm.cmd run test:h5:home-sticky
```

The command must build current source before inspecting `miniprogram/dist/build/h5`, so a stale artifact can never produce a false pass. Expected before the production fix: FAIL because the production template has no rendered `.section-tabs-sticky-shell` around the visible topic component.

- [ ] **Step 5: Move native release evidence to the visible custom components**

Update the existing home-tabs static script and WeChat release UI gate to query `archive-topic-tabs .archive-topic-tab` and `archive-waterfall .archive-waterfall__card` through their custom-component hosts. Remove all evidence queries for the hidden legacy `.section-tab` and `.arc-item` nodes. Provision three valid native `area: archive` RichNote posts in the isolated release fixture, with exactly one post carrying the filter topic, so the gate proves the visible 3-to-1 switch instead of populating the removed legacy feed. The release runner must actually execute the `archiveTabs` stage, retry only the idempotent membership apply on `TransactionBusy`, and wait for the observable active-label/card-count state rather than a fixed delay.

### Task 2: Attach sticky behavior to the real component

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`

- [ ] **Step 1: Wrap the visible component and remove the hidden copy**

Change the archive template to:

```vue
<view class="archive-topic-shell">
  <view class="section-tabs-sticky-shell section-tabs-sticky-shell--archive">
    <ArchiveTopicTabs
      :tabs="archiveTabs"
      :model-value="selectedArchiveTopic"
      @update:model-value="selectArchiveTopic"
    />
  </view>
  <ArchiveWaterfall
    :columns="archiveColumns"
    :loading="archiveLoading"
    :error="archiveError"
    :has-more="archiveHasMore"
    @post="onArchiveCardTap"
    @publish="openArchivePublish"
    @retry="loadArchiveFeed(true)"
    @load-more="loadArchiveFeed(false)"
  />
</view>
```

Delete only the hidden legacy `.section-tabs-sticky-shell` block. Keep the unrelated hidden legacy feed branch unchanged.

- [ ] **Step 2: Preserve current topic spacing**

Add the page-level modifier:

```scss
.section-tabs-sticky-shell--archive {
  margin: 0;
  padding: 0;
}
```

Do not change the base sticky top, z-index, transparent surface, search geometry, hero gradient, or `ArchiveTopicTabs` visual rules.

- [ ] **Step 3: Run focused tests and verify GREEN**

```powershell
npx.cmd vitest run src/utils/__tests__/home-sticky-layout-static.test.ts
npm.cmd run test:h5:home-sticky
node scripts/test-home-tabs-scroll-static.mjs
node --test scripts/lib/mp-release-ui-policy.test.mjs
```

Expected: the static production-DOM contract and real rendered two-stage sticky geometry both pass.

- [ ] **Step 4: Commit the regression fix**

Commit the production and test files as `AngryBird <48046333+angrybirddd@users.noreply.github.com>`.

### Task 3: Verify platform behavior proportionally

**Files:**
- Verify only unless an in-scope failure requires a tested correction.

- [ ] **Step 1: Run repository checks**

```powershell
npm.cmd -w miniprogram run type-check
npm.cmd -w miniprogram run test:unit
npm.cmd run test:h5:home-sticky
npm.cmd -w miniprogram run build:mp-weixin
node scripts/test-home-tabs-scroll-static.mjs
node --test scripts/lib/mp-release-ui-policy.test.mjs
npm.cmd run docs:check
git diff --check 055502ad25fcb93aa61ead13e5465f0a6450233f..HEAD
```

- [ ] **Step 2: Validate the rendered target flow**

The flow under test is: `/` → scroll search beneath the fixed community masthead → continue scrolling until visible topic Tabs reach search → search remains pinned and the same visible topic Tabs pin directly below it → reverse scroll releases both without a jump.

At 390 × 844, verify page identity, nonblank content, no framework overlay, relevant console health, screenshot evidence, and the target interaction. Treat H5 as geometry precheck; use the existing WeChat DevTools/release UI path when the machine validation lease and current runtime permit it.

- [ ] **Step 3: Review the exact diff**

Review `055502ad25fcb93aa61ead13e5465f0a6450233f..HEAD` for duplicate visible tabs, parent-boundary release, offset mismatch, layout spacing changes, false-positive tests, and unrelated edits. Fix only confirmed in-scope findings with a failing test first.

### Task 4: Deliver through PR and Merge Queue

**Files:**
- No production deployment files.

- [ ] Confirm cwd, branch, HEAD, AngryBird identity, and a clean worktree.
- [ ] Push `codex/home-tabs-sticky-regression` and create a ready PR that records root cause, tests, no cloud/admin/data changes, and main-release ownership.
- [ ] Register the feature PR feedback loop and track exact-HEAD checks, reviews, comments, and unresolved threads.
- [ ] Arm GitHub Merge Queue only after the PR is merge-ready; monitor `merge_group` CI until the PR reaches `MERGED` or `CLOSED`.
- [ ] Do not deploy, upload the mini-program, or mutate shared cloud state from this feature worktree.
