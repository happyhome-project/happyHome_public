# HappyHome First-Open Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a lightweight local routing shell before Home, pre-fetch public Home data during startup, and collect startup timings without adding work before first paint.

**Architecture:** A new default startup page owns only a branded routing shell and routes to the existing Home tab after its first render. The existing official background-fetch channel gains a strictly public guest branch, while authenticated snapshots keep their revalidation boundary. Native performance entries are buffered until page readiness and then enter the existing opt-in diagnostic pipeline.

**Tech Stack:** uni-app, Vue 3, Pinia, TypeScript, Vitest, Jest, WeChat Mini Program background fetch and performance APIs.

**Spec:** `docs/superpowers/specs/2026-08-27-first-open-performance-design.md`

## Global Constraints

- The first paint must not depend on cloud data or prior business cache.
- The retired guest introduction must not be restored; guest browsing continues directly to Home and login stays on Profile.
- Invalid explicit background-fetch tokens must not fall back to public data.
- Authenticated cached or prefetched posts stay hidden until bootstrap revalidates membership.
- Startup trace data contains timings and non-sensitive counts only and performs no pre-paint upload.
- Existing deep links and tab bar paths remain unchanged.
- Do not deploy, release, upload the mini-program, or mutate shared cloud state.

---

### Task 1: Lightweight startup routing page

**Files:**
- Create: `miniprogram/src/pages/startup/index.vue`
- Modify: `miniprogram/src/pages.json`
- Modify: `miniprogram/src/utils/__tests__/guest-intro.test.ts`

**Interfaces:**
- Produces: a no-data startup shell that calls `switchTab('/pages/index/index')` only after `onReady`.
- Consumes: only page lifecycle, diagnostics, and the existing Home tab route.

- [ ] **Step 1: Write the failing default-entry regression test**

  Require the startup page to be the default entry, route after `onReady`, and contain no guest-intro, user-store, upload, or Home-component dependency.

- [ ] **Step 2: Run the focused Vitest file and verify RED**

  Run: `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/guest-intro.test.ts`

  Expected: FAIL because the startup page does not exist or still contains retired guest-intro/login work.

- [ ] **Step 3: Implement the minimal routing shell**

  Paint the local shell, route Home after readiness, and keep tap as the failure retry path. Home owns normal trace finalization; the shell finalizes only when routing fails.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run the same Vitest command and require zero failures.

- [ ] **Step 5: Add the entry configuration**

  Set `entryPagePath` without changing the Home tab path or direct/deep-link routes.

- [ ] **Step 6: Run guest/startup tests and a WeChat build**

  Run:

  `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/guest-intro.test.ts`

  `npm.cmd --workspace miniprogram run build:mp-weixin`

  Inspect generated `app.json` and startup page dependencies.

### Task 2: Resolve login before background hydration

**Files:**
- Modify: `miniprogram/src/store/__tests__/user-web-auth.test.ts`
- Modify: `miniprogram/src/store/user.ts`

**Interfaces:**
- `login()` and `webLogin()` keep their public signatures.
- Membership hydration continues through `hydrateMembershipsAfterLogin(shouldApply?)`, but is no longer awaited by login completion.

- [ ] **Step 1: Write failing deferred-hydration tests**

  Make `loadMyCommunities` never settle and assert that direct and web login still resolve after committing identity.

- [ ] **Step 2: Run the focused store test and verify RED**

  Run: `npm.cmd --workspace miniprogram exec vitest run src/store/__tests__/user-web-auth.test.ts`

  Expected: the new timeout race reports pending login.

- [ ] **Step 3: Start hydration without awaiting it**

  Preserve cancellation predicates and error containment. Do not roll back a successful login because later membership hydration fails.

- [ ] **Step 4: Run the store tests and verify GREEN**

  Run the same Vitest command and require zero failures.

### Task 3: Public guest background pre-fetch

**Files:**
- Modify: `cloud/functions/home-prefetch/__tests__/home-prefetch.test.ts`
- Modify: `cloud/functions/home-prefetch/index.ts`
- Modify: `miniprogram/src/utils/__tests__/home-snapshot-cache.test.ts`
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`
- Modify: `docs/miniprogram-pre-fetch.md`

**Interfaces:**
- A Cloud Development direct invocation with a missing token plus non-empty `code` produces `buildHomeSnapshot('')`; public HTTP requests without a valid token remain empty.
- A present invalid token produces `emptyHomeSnapshot('')`.
- Signed-out Home calls `getBestBackgroundFetchSnapshot({ openId: '' })` and may apply its public posts.

- [ ] **Step 1: Write failing backend guest/invalid-token tests**

  Provide an active configured public community fixture for the `code` request and independently assert the invalid-token response stays empty.

- [ ] **Step 2: Run the focused Jest test and verify RED**

  Run: `npm.cmd --workspace cloud exec jest --config jest.config.js functions/home-prefetch/__tests__/home-prefetch.test.ts --runInBand`

- [ ] **Step 3: Implement the guest pre-fetch branch**

  Branch on token presence before resolution. Keep OPTIONS, non-GET, serializer, and safe-fallback behavior unchanged.

- [ ] **Step 4: Run backend test and verify GREEN**

  Run the same Jest command and require zero failures.

- [ ] **Step 5: Write failing client guest-pre-fetch tests**

  Cover `openId: ''` acceptance and the policy that guest public pre-fetch retains posts while authenticated pre-fetch becomes a shell.

- [ ] **Step 6: Run focused Vitest tests and verify RED**

  Run: `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/home-snapshot-cache.test.ts src/utils/__tests__/community-pages-figma.test.ts`

- [ ] **Step 7: Implement guest read and public-post application**

  Start the pre-fetch read without awaiting it before bootstrap; fence late data against a newer cloud snapshot and the current viewer/community.

- [ ] **Step 8: Run focused tests and verify GREEN**

  Run the same Vitest command and require zero failures.

### Task 4: Post-ready startup performance capture

**Files:**
- Create: `miniprogram/src/utils/startup-performance.ts`
- Create: `miniprogram/src/utils/__tests__/startup-performance.test.ts`
- Modify: `miniprogram/src/main.ts`
- Modify: `miniprogram/src/pages/startup/index.vue`
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/utils/client-log.ts`
- Modify: `miniprogram/src/utils/__tests__/client-log.test.ts`

**Interfaces:**
- `installStartupPerformanceCapture()` observes native performance entries and buffers normalized non-sensitive records in memory.
- `flushStartupPerformanceCapture(record)` drains the buffer only when a page calls it after `onReady`.

- [ ] **Step 1: Write failing buffer/normalization tests**

  Assert allowed entry names are retained, arbitrary fields are dropped, no recorder is called during installation, and flushing drains once.

- [ ] **Step 2: Run focused Vitest tests and verify RED**

  Run: `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/startup-performance.test.ts src/utils/__tests__/client-log.test.ts`

- [ ] **Step 3: Implement capture and remove unconditional launch upload**

  Install capture at app creation, flush from page readiness, and keep warn/error, verbose, and explicit-diagnostic upload paths intact.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Run the same Vitest command and require zero failures.

### Task 5: Full verification, review, and PR

**Files:**
- Review all files changed by Tasks 1-4.

**Interfaces:**
- Consumes all preceding task contracts.
- Produces a tested feature commit and pull request against `main`.

- [ ] **Step 1: Verify generated startup packaging**

  Run `npm.cmd --workspace miniprogram run build:mp-weixin`; require generated `app.json` to contain the startup `entryPagePath`, and confirm startup JSON has no Home components.

- [ ] **Step 2: Run full validation**

  Run:

  `npm.cmd --workspace miniprogram run type-check`

  `npm.cmd --workspace miniprogram run test:unit`

  `npm.cmd --workspace cloud test`

- [ ] **Step 3: Inspect diff and request code review**

  Review `git diff --check`, package-size deltas, security boundaries, late-response fencing, startup critical-path writes, and the approved spec. Dispatch one read-only reviewer against `origin/main..HEAD` after the commit and fix all Critical/Important findings with new regression tests.

- [ ] **Step 4: Commit and push**

  Commit as `AngryBird <48046333+angrybirddd@users.noreply.github.com>`, ordinary-push `codex/login-cold-start-performance`, and verify the remote branch exact SHA.

- [ ] **Step 5: Create the PR and begin ownership loop**

  Create a non-draft PR to `main`, verify exact HEAD/check state, and monitor it under the PR feedback-loop contract. Do not deploy or release from this worktree.
