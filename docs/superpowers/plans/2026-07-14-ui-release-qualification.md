# UI Release Qualification Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-14 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [formal release gate](../../release-gate.md), current release code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one reusable, exact-identity UI qualification so formal prepare does not repeatedly rebuild and rediscover release UI failures one at a time.

**Architecture:** Keep the existing DevTools UI implementation as the only real UI runner. Add small testable modules for qualification identity, dependency-aware result aggregation, and cleanup retry; then let `deploy.mjs` explicitly create or consume a qualification wrapper. Existing prepare behavior remains the fallback when no wrapper is supplied.

**Tech Stack:** Node.js ESM, `node:test`, existing release ledger, WeChat DevTools automator, PowerShell/Windows release environment.

---

### Task 1: Qualification identity and strict inspector

**Files:**
- Create: `scripts/lib/release-ui-qualification.mjs`
- Create: `scripts/lib/release-ui-qualification.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing identity tests**

Test a wished-for API:

```js
const wrapper = await writeReleaseUiQualification({
  outputPath, gitSha, version, desc, packageRoot, devToolsVersion,
  sourceBuildInfoPath, distBuildInfoPath, uiEvidencePath,
})
const inspected = await inspectReleaseUiQualification({ qualificationPath: outputPath, root, expected: { gitSha, version, desc } })
assert.equal(inspected.packageDigest, wrapper.packageDigest)
```

Add table tests that independently change git SHA, package bytes, source/dist build-info, DevTools version, required markers, evidence SHA-256, and project path. Each must reject with a field-specific message. Ensure wrapper JSON never contains token/openid fields.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test scripts/lib/release-ui-qualification.test.mjs`

Expected: fail because `release-ui-qualification.mjs` does not exist.

- [ ] **Step 3: Implement the minimal module**

Export exactly three public interfaces: constant `RELEASE_UI_QUALIFICATION_SCHEMA = 1`, async `writeReleaseUiQualification(input)`, and async `inspectReleaseUiQualification({ qualificationPath, root, expected, currentDevToolsVersion })`.

Use existing `computeDirectoryDigest`, build-info parsing, `assertReleaseUiEvidence`, `createHash('sha256')`, absolute normalized paths, and an atomic temp-file rename. No `latest` lookup and no remote calls.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test scripts/lib/release-ui-qualification.test.mjs`

Expected: all qualification identity tests pass.

- [ ] **Step 5: Add the test to the existing policy lane and commit**

Add the new test file to `test:mp:replay-policy`, rerun that script, then commit:

```powershell
git add package.json scripts/lib/release-ui-qualification.mjs scripts/lib/release-ui-qualification.test.mjs
git commit -m "feat(release): bind reusable UI qualification evidence"
```

### Task 2: Bounded fixture cleanup for observed transient failures

**Files:**
- Create: `scripts/lib/release-ui-fixture-cleanup.mjs`
- Create: `scripts/lib/release-ui-fixture-cleanup.test.mjs`
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing cleanup tests**

Cover the real incidents:

```js
await cleanupReleaseFixtureWithRetry({
  actions: ['community.disable', 'community.hardDelete'],
  invoke: async (action) => {
    calls.push(action)
    if (action === 'community.hardDelete' && calls.length === 2) throw new Error('[ResourceUnavailable.TransactionBusy]')
    return { success: true }
  },
  sleep: async () => {},
})
```

Assert at most two attempts per action, transient timeout/TransactionBusy/reset retries, permission/parameter errors do not retry, all actions are attempted, final failures are sanitized and aggregated, and `ok=false` blocks success.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test scripts/lib/release-ui-fixture-cleanup.test.mjs`

Expected: fail because the helper does not exist.

- [ ] **Step 3: Implement and integrate the helper**

Export `isTransientReleaseUiCleanupError` and `cleanupReleaseFixtureWithRetry`. Use two attempts, a short injected delay, and no broad `/member|error/` matching. Replace the inline cleanup loop in `test-mp-release-ui.mjs`; preserve trusted admin invocation and ensure catch/finally cannot silently discard a failed final cleanup.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test scripts/lib/release-ui-fixture-cleanup.test.mjs scripts/lib/trusted-admin-invoke.test.mjs
npm.cmd run test:mp:replay-policy
```

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/lib/release-ui-fixture-cleanup.mjs scripts/lib/release-ui-fixture-cleanup.test.mjs scripts/test-mp-release-ui.mjs
git commit -m "fix(release): bound transient UI fixture cleanup"
```

### Task 3: Dependency-aware UI failure aggregation

**Files:**
- Create: `scripts/lib/release-ui-check-runner.mjs`
- Create: `scripts/lib/release-ui-check-runner.test.mjs`
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing orchestration tests**

Define injected checks and assert call order:

```js
const result = await runReleaseUiChecks({
  coldStart: pass,
  provisionFixture: passFixture,
  archiveTabs: fail('tabs'),
  homeDetail: pass,
  profile: fail('profile'),
  cleanup: pass,
})
assert.deepEqual(calls, ['coldStart', 'fixture', 'archiveTabs', 'homeDetail', 'profile', 'cleanup'])
assert.deepEqual(result.failures.map(x => x.stage), ['archiveTabs', 'profile'])
```

Also assert cold-start failure skips fixture-dependent checks but still runs profile; fixture provisioning failure still runs profile and cleanup; cleanup runs before the final aggregate error; errors are sanitized.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test scripts/lib/release-ui-check-runner.test.mjs`

- [ ] **Step 3: Implement the small runner and integrate it**

The runner executes sequentially, returns structured stage results, and throws only after cleanup. Move no DevTools selectors or business logic into the runner; inject the existing functions from `test-mp-release-ui.mjs`.

- [ ] **Step 4: Make every optional screenshot bounded**

Change final evidence screenshot to call `captureOptionalReleaseUiScreenshot` rather than raw `await mp.screenshot`. Add a policy test proving both screenshot sites use the bounded helper.

- [ ] **Step 5: Run tests and commit**

Run `npm.cmd run test:mp:replay-policy`, then commit runner, tests, and integration changes with:

```powershell
git commit -m "fix(release): report independent UI gate failures together"
```

### Task 4: Explicit qualification command

**Files:**
- Modify: `scripts/deploy.mjs`
- Modify: `scripts/lib/release-policy.test.mjs`
- Modify: `package.json`
- Modify: `docs/release-gate.md`

- [ ] **Step 1: Write failing policy tests**

Assert package exposes `release:ui-qualify`, deploy target requires explicit `--version`, `--desc`, and `--ui-qualification`, passes trusted `HH_RELEASE_GIT_SHA` into the UI runner, writes the wrapper only after the full gate passes, and does not build cloud/admin or mutate production.

- [ ] **Step 2: Run the policy test and verify RED**

Run: `node --test scripts/lib/release-policy.test.mjs`

- [ ] **Step 3: Implement the target**

Add `release-ui-qualify` to `deploy.mjs`. Reuse `writeBuildInfo` and `buildAndGateMiniprogramUpload`; after success call `writeReleaseUiQualification`. Require an absolute output path and pass exact main SHA plus DevTools version. Do not acquire production release lock or create a production release run.

- [ ] **Step 4: Document the exact command**

```powershell
npm.cmd run release:ui-qualify -- --version=<v> --desc=<d> --ui-qualification=<absolute-json-path>
```

- [ ] **Step 5: Run targeted tests and commit**

Run `npm.cmd run test:mp:replay-policy` and `npm.cmd run test:deploy-output`, then commit.

### Task 5: Prepare consumes qualification without rebuilding UI

**Files:**
- Modify: `scripts/deploy.mjs`
- Modify: `scripts/lib/release-run-ledger.mjs`
- Modify: `scripts/lib/release-run-ledger.test.mjs`
- Modify: `scripts/lib/release-policy.test.mjs`

- [ ] **Step 1: Write failing reuse tests**

Create a valid qualification fixture and assert explicit reuse records `qualificationPath`, `qualificationDigest`, package digest, UI evidence path, and build-info in `miniprogram-build-gate` while build/DevTools runners have zero calls. Assert invalid explicit qualification fails before those runners. Assert no flag keeps the current build-and-gate path.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test scripts/lib/release-run-ledger.test.mjs scripts/lib/release-policy.test.mjs
```

- [ ] **Step 3: Implement explicit prepare reuse**

Parse `--ui-qualification=<absolute-path>`. When present, call the strict inspector and construct the same prepared evidence shape returned by `buildAndGateMiniprogramUpload`; do not silently fall back. Pin the already-built miniprogram plus normal cloud/admin artifacts to the new release run.

- [ ] **Step 4: Revalidate on publish resume**

Extend prepared evidence inspection so qualification-backed stages fresh-check wrapper digest, package digest, UI evidence digest/markers, source/dist build-info, SHA/version/desc, and DevTools version. Ordinary same-run prepared evidence keeps its current exact-runId validation.

- [ ] **Step 5: Run tests and commit**

Run `npm.cmd run test:deploy-output` and `npm.cmd run test:mp:replay-policy`, then commit.

### Task 6: End-to-end local acceptance and PR

**Files:**
- Modify only files already listed if acceptance exposes a direct defect.

- [ ] **Step 1: Run all affected offline gates**

```powershell
npm.cmd run test:mp:replay-policy
npm.cmd run test:deploy-output
npm.cmd run test:governance
git diff --check
```

- [ ] **Step 2: Run one real qualification**

From the feature worktree, run the explicit qualification command against one pinned version/desc. Confirm all required markers, cleanup success, and wrapper identity. This creates temporary fixtures only through the existing validation lease and must clean them.

- [ ] **Step 3: Prove prepare reuse without a second DevTools run**

From a clean synchronized canonical-main-compatible audit fixture or the project-supported non-production test harness, inspect the qualification and assert build/DevTools invocation count is zero. Do not deploy, publish, upload, or mutate production from the feature worktree.

- [ ] **Step 4: One self-review and one independent P0/P1 review**

Fix only acceptance-related P0/P1 findings. Record P2 items without expanding scope.

- [ ] **Step 5: Push and create the PR**

The PR must state: no production deploy/upload, exact tests, real qualification fixture cleanup, CLI interface, rollback behavior, and measured qualification/prepare-reuse durations. Monitor exact-head PR CI and Merge Queue to `MERGED`.
