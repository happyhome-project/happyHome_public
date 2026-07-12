# Home Tabs Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home page's duplicated threshold-switched search/tabs controls with one stable category-tabs control that pins naturally while the search field scrolls away.

**Architecture:** Keep the existing in-flow tabs as the only tabs DOM and make that container sticky below the safe area. Remove the fixed duplicate, its scroll threshold state/measurement, and the conditional flow collapse; preserve archive selection and deliberate scroll restoration when users change archive groups.

**Tech Stack:** Vue 3, uni-app, TypeScript, SCSS, Node static contract tests, Vitest, H5 preview, mp-weixin build

---

### Task 1: Lock the single-tabs interaction contract

**Files:**
- Create: `scripts/test-home-tabs-scroll-static.mjs`
- Modify: `scripts/test-figma-mini-ui-static.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the focused failing static regression test**

Create `scripts/test-home-tabs-scroll-static.mjs` with assertions equivalent to:

```js
import fs from 'fs'
import path from 'path'

const home = fs.readFileSync(
  path.join(process.cwd(), 'miniprogram', 'src', 'pages', 'index', 'index.vue'),
  'utf8'
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert((home.match(/class="section-tabs section-tabs--sticky"/g) || []).length === 1,
  'home should render exactly one sticky category-tabs control.')
assert(!home.includes('class="home-fixed-controls"'),
  'home should not render a duplicated fixed search-and-tabs control.')
assert(!home.includes('showHomeFixedControls') && !home.includes('homeFixedControlsThresholdPx'),
  'home should not switch tabs copies from a page-scroll threshold.')
assert(!home.includes('is-shadowed-by-fixed') && !home.includes('section-tabs--flow'),
  'home should not collapse the in-flow tabs during sticky transition.')
assert(home.includes('position: sticky;') && home.includes('env(safe-area-inset-top)'),
  'home tabs should pin through sticky positioning below the safe area.')

console.log('[home-tabs-scroll-static] PASS')
```

- [ ] **Step 2: Register the focused test command**

Add this root script to `package.json`:

```json
"test:mp:home-tabs-scroll-static": "node scripts/test-home-tabs-scroll-static.mjs"
```

- [ ] **Step 3: Update the broad Figma contract to describe the approved structure**

Replace assertions requiring `home-fixed-controls`, `showHomeFixedControls`, threshold measurement, `section-tabs--fixed`, `section-tabs--flow`, and `is-shadowed-by-fixed` with assertions requiring one `section-tabs--sticky`, `position: sticky`, and no duplicate fixed controls.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npm.cmd run test:mp:home-tabs-scroll-static`

Expected: FAIL with `home should render exactly one sticky category-tabs control.` because production still contains the duplicated fixed/flow implementation.

### Task 2: Replace the duplicated handoff with one sticky tabs control

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Test: `scripts/test-home-tabs-scroll-static.mjs`
- Test: `scripts/test-figma-mini-ui-static.mjs`

- [ ] **Step 1: Remove the duplicated fixed control template**

Delete the `home-fixed-controls` block containing the duplicate search field and `section-tabs--fixed`. Change the remaining tabs markup to:

```vue
<scroll-view
  v-if="archiveGroups.length"
  scroll-x
  class="section-tabs section-tabs--sticky"
  :show-scrollbar="false"
>
```

- [ ] **Step 2: Remove threshold-only state and measurement**

Remove `homeFixedControlsThresholdPx`, its timers/constants, `showHomeFixedControls`, `measureHomeFixedControlsThreshold`, scheduling/cleanup, and calls to that scheduler. Retain `homePageScrollTop`, `onPageScroll`, and `getCurrentPageScrollTop()` because archive-group switching uses them to preserve the user's current scroll position on both native and H5 surfaces.

- [ ] **Step 3: Preserve scroll runway without fixed-control coupling**

Delete the dependency on `showHomeFixedControls`, but keep `min-height: 100vh` for an active non-guide group unconditionally. This preserves enough document runway to prevent native scroll clamping when a user switches from a tall archive to a short archive while the tabs are pinned. Preserve the measured guide-feed minimum height behavior.

- [ ] **Step 4: Apply stable sticky styling to the single tabs control**

Replace fixed/collapse styles with:

```scss
.section-tabs--sticky {
  position: sticky;
  top: env(safe-area-inset-top);
  z-index: $hh-z-sticky;
  margin: 34rpx 0 20rpx;
  padding: 12rpx 0;
  background: rgba(250, 250, 249, 0.96);
  box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.07);
  backdrop-filter: blur(18rpx);
}
```

Keep `.section-tabs-inner` and `.section-tab` visual styles unchanged.

- [ ] **Step 5: Run focused and broad tests and verify GREEN**

Run:

```powershell
npm.cmd run test:mp:home-tabs-scroll-static
node scripts/test-figma-mini-ui-static.mjs
```

Expected: the focused command prints its PASS marker and exits 0. The broad Figma command is also run; this branch inherits a pre-existing failure in two stale image-key expectations, independently reproducible from `HEAD`, so do not expand this task into unrelated image-key test maintenance.

### Task 3: Verify compilation and rendered behavior

**Files:**
- Modify only if a defect is reproduced: `miniprogram/src/pages/index/index.vue`
- Do not commit screenshots or temporary browser scripts.

- [ ] **Step 1: Run mini-program checks**

Run:

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: all commands exit 0 with no failed tests or build errors.

- [ ] **Step 2: Start isolated H5 preview**

Run on the worktree-specific free port:

```powershell
npm.cmd --workspace miniprogram run dev:h5 -- --host 127.0.0.1 --port 5183
```

Open `http://127.0.0.1:5183/#/pages/index/index` at a mobile viewport. Do not reuse port 5173 or another worktree's process.

- [ ] **Step 3: Exercise the approved interaction**

Verify: home loads -> search field is visible -> scroll upward through the category-tabs natural position -> search field leaves the viewport -> the same tabs remain pinned below the safe area -> content does not jump -> tab selection remains interactive.

Capture before-threshold and pinned-state screenshots outside the repository and inspect console warnings/errors.

- [ ] **Step 4: Review final diff and commit implementation**

Run:

```powershell
git diff --check
git diff --stat
git status --short --branch
```

Commit only the focused test, package script, broad-contract adjustment, and home-page implementation with:

```powershell
git add package.json scripts/test-home-tabs-scroll-static.mjs scripts/test-figma-mini-ui-static.mjs miniprogram/src/pages/index/index.vue
git commit -m "fix: make home tabs scroll naturally"
```
