# Full-Current Public Release Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-12 implementation sequence. It does not override later release policy or operational evidence.
> **Current authority:** Use the [formal release gate](../../release-gate.md), repository rules, current release code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, fail-closed `full-current` mode that formally releases the exact current public `main` without using the legacy production SHA as a Git diff base.

**Architecture:** Extend the existing planner with one forced-target strategy, then bind that strategy through the existing prepare ledger and publish resume path. Reuse the existing production lock, operations allowlist, migrations, UI evidence, cloud probes/smoke/cleanup, deployments, upload digest, and guarded remote completion; only canonical identity, strategy selection, and plan construction change.

**Tech Stack:** Node.js 24 ESM, `node:test`, PowerShell/npm scripts, Git, CloudBase release store, WeChat DevTools release evidence.

---

## File Map

- Modify `scripts/lib/release-plan.mjs`: define the `full-current` plan shape and forced targets.
- Modify `scripts/release-plan.mjs`: select the new CLI mode, skip production-base lookup, and include every checked-in manifest.
- Modify `scripts/lib/release-plan.test.mjs`: unit-test forced targets, manifest validation, and unchanged incremental behavior.
- Modify `scripts/lib/release-plan-base.test.mjs`: retain explicit proof that normal `main` still uses production state and malformed state fails closed.
- Modify `scripts/lib/release-policy.mjs`: authorize only the public canonical path and exact public origin; require explicit full-current intent.
- Modify `scripts/lib/release-policy.test.mjs`: test path, origin, branch, dirty/stale state, and explicit-mode rejection.
- Modify `scripts/lib/release-run-ledger.mjs`: persist `releaseStrategy` and reject resume mismatches.
- Modify `scripts/lib/release-run-ledger.test.mjs`: test strategy/SHA binding and remote-completion identity.
- Modify `scripts/deploy.mjs`: thread `full-current` through prepare, planner invocation, publish, ledger, and existing release stages.
- Modify `AGENTS.md`, `docs/SETUP.md`, and `docs/release-gate.md`: make public `main` the production canonical and document explicit commands.
- Modify `X:\Users\86136\.codex\skills\happyhome-release\SKILL.md`: update the operator skill to the public path and explicit full-current prepare/publish commands. This user-local file is outside the repository and is verified separately, not included in a repository commit.

### Task 1: Model the full-current plan

**Files:**
- Modify: `scripts/lib/release-plan.mjs:1-145`
- Test: `scripts/lib/release-plan.test.mjs`

- [ ] **Step 1: Add failing plan-shape tests**

Append tests that pass all manifests directly to the plan constructor and require the exact forced shape:

```js
test('full-current plans force every runtime target and every validated manifest', () => {
  const manifests = [{
    schemaVersion: 1,
    changeId: 'indexes',
    actions: ['ensure-indexes'],
    migrations: [{ id: 'backfill', module: 'release/migrations/backfill.mjs' }],
    smokeSuites: [],
  }]
  const plan = createReleasePlan({
    baseSha: '',
    headSha: 'public-head',
    changedPaths: [],
    allFunctions: ['post', 'user'],
    functionInputs: {},
    manifests,
    mode: 'full-current',
  })

  assert.equal(plan.baseSha, null)
  assert.equal(plan.bootstrap, false)
  assert.equal(plan.planningStrategy, 'full-current')
  assert.equal(plan.releaseRequired, true)
  assert.deepEqual(plan.targets.cloud, {
    functions: ['post', 'user'],
    mode: 'all',
    reasons: ['full-current:explicit'],
  })
  assert.equal(plan.targets.adminWeb, true)
  assert.equal(plan.targets.miniprogram, true)
  assert.deepEqual(plan.changeIds, ['indexes'])
  assert.deepEqual(plan.manifests, manifests)
})

test('normal main planning remains incremental', () => {
  const plan = createReleasePlan({
    baseSha: 'public-base',
    headSha: 'public-head',
    changedPaths: ['admin-web/src/App.vue'],
    allFunctions: ['post'],
    functionInputs: {},
    manifests: [],
    mode: 'main',
  })
  assert.equal(plan.planningStrategy, 'incremental')
  assert.equal(plan.targets.adminWeb, true)
  assert.equal(plan.targets.miniprogram, false)
  assert.equal(plan.targets.cloud.mode, 'none')
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test scripts/lib/release-plan.test.mjs`

Expected: FAIL because `full-current` is not an accepted mode and `planningStrategy` is absent.

- [ ] **Step 3: Implement the minimal plan branch**

In `createReleasePlan`, accept the third mode and force targets without treating it as bootstrap:

```js
const allowedModes = new Set(['main', 'pr', 'full-current'])
if (!allowedModes.has(mode)) {
  throw new Error(`release plan mode must be main, pr, or full-current; got ${mode || '(missing)'}`)
}
const manifestSummary = validateChangeManifests(manifests)
if (needsExternalManifest(changedPaths) && !manifests.length) {
  throw new Error('external release changes require a release/changes manifest')
}
const fullCurrent = mode === 'full-current'
const bootstrap = mode === 'main' && !baseSha
const targets = fullCurrent
  ? {
      adminWeb: true,
      cloud: allCloud(allFunctions, 'full-current:explicit'),
      miniprogram: true,
    }
  : classifyReleaseImpact({ changedPaths, allFunctions, functionInputs })
if (bootstrap) targets.cloud = allCloud(allFunctions, 'bootstrap:no-production-base')
const hasRuntimeTarget = targets.cloud.functions.length > 0 || targets.miniprogram || targets.adminWeb
return {
  baseSha: baseSha || null,
  bootstrap,
  changeIds: manifestSummary.changeIds,
  changedPaths: changedPaths.map(normalizePath),
  headSha,
  manifests,
  mode,
  planningStrategy: fullCurrent ? 'full-current' : bootstrap ? 'bootstrap' : 'incremental',
  releaseRequired: fullCurrent || bootstrap || hasRuntimeTarget || manifests.length > 0,
  targets,
}
```

- [ ] **Step 4: Run the planner tests and confirm GREEN**

Run: `node --test scripts/lib/release-plan.test.mjs scripts/lib/release-plan-base.test.mjs`

Expected: all planner and production-base tests PASS.

- [ ] **Step 5: Commit the planner model**

```powershell
git add scripts/lib/release-plan.mjs scripts/lib/release-plan.test.mjs
git commit -m "feat: model full-current release plans"
```

### Task 2: Make planner CLI explicitly bypass the historical base

**Files:**
- Modify: `scripts/release-plan.mjs:18-105`
- Test: `scripts/lib/release-plan.test.mjs`

- [ ] **Step 1: Add a pure manifest-selection test**

Export a small selector from `scripts/lib/release-plan.mjs`, then add this failing test:

```js
import { selectChangeManifests, selectChangeManifestsForDiff } from './release-plan.mjs'

test('full-current selects all manifests while main selects only changed manifests', () => {
  const manifests = [
    { changeId: 'first', source: 'release/changes/first.json' },
    { changeId: 'second', source: 'release/changes/second.json' },
  ]
  const changes = ['M\trelease/changes/second.json']
  assert.deepEqual(selectChangeManifests('full-current', manifests, changes), manifests)
  assert.deepEqual(selectChangeManifests('main', manifests, changes), [manifests[1]])
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test scripts/lib/release-plan.test.mjs`

Expected: FAIL because `selectChangeManifests` is not exported.

- [ ] **Step 3: Add the selector and CLI mode routing**

Add this helper beside `selectChangeManifestsForDiff`:

```js
export function selectChangeManifests(mode, manifests = [], changedPaths = []) {
  return mode === 'full-current' ? [...manifests] : selectChangeManifestsForDiff(manifests, changedPaths)
}
```

In `scripts/release-plan.mjs`, import `selectChangeManifests`, accept `full-current`, do not call `resolveMainReleasePlanBase` in that branch, do not call `git cat-file` or `git merge-base` for a missing legacy SHA, and use all manifests:

```js
if (!['main', 'pr', 'full-current'].includes(mode)) {
  throw new Error('use --mode=pr, --mode=main, or --mode=full-current')
}
const fullCurrent = mode === 'full-current'
if (mode === 'pr') {
  baseSha = baseSha || git(['merge-base', headSha, 'origin/main'], root)
  baseSource = baseSource || 'origin-main-merge-base'
} else if (fullCurrent) {
  if (baseSha) throw new Error('full-current does not accept --base')
  baseSha = ''
  baseSource = 'full-current'
} else {
  const resolved = await resolveMainReleasePlanBase({
    explicitBase: baseSha,
    readProductionState: async () => await createProductionReleaseStore({ root }).readProductionState(),
  })
  baseSha = resolved.baseSha
  baseSource = resolved.source
}
const changes = fullCurrent ? [] : changedPaths(root, baseSha, headSha)
const allManifests = readManifests(root)
const manifests = selectChangeManifests(mode, allManifests, changes)
```

Use this output filename expression so formal publish reads the same exact-SHA path for `main` and `full-current`:

```js
const outputName = mode === 'pr' ? `pr-${headSha}.json` : `${headSha}.json`
```

Update `printSummary` so absence of a historical base is not mislabeled as bootstrap:

```js
const baseLabel = plan.planningStrategy === 'full-current' ? '(none)' : plan.baseSha || '(bootstrap)'
console.log(`[release-plan] mode=${plan.mode} head=${plan.headSha} base=${baseLabel} source=${baseSource}`)
```

- [ ] **Step 4: Verify focused behavior**

Run: `node --test scripts/lib/release-plan.test.mjs scripts/lib/release-plan-base.test.mjs`

Expected: PASS, including the existing malformed-production-state rejection for normal `main`.

Do not run a successful `--mode=full-current` CLI plan from this feature worktree. Task 3 adds the required canonical-main gate; the successful CLI path is intentionally available only after merge from clean synchronized public `main`. Unit tests in this task prove the generated shape without weakening that boundary.

- [ ] **Step 5: Commit CLI planning**

```powershell
git add scripts/release-plan.mjs scripts/lib/release-plan.mjs scripts/lib/release-plan.test.mjs
git commit -m "feat: add explicit full-current planning"
```

### Task 3: Move formal-release authorization to public canonical main

**Files:**
- Modify: `scripts/lib/release-policy.mjs:1-58`
- Modify: `scripts/deploy.mjs:185-213`
- Modify: `scripts/release-plan.mjs:55-105`
- Test: `scripts/lib/release-policy.test.mjs:103-148`

- [ ] **Step 1: Replace the policy fixtures with public identity and add failure cases**

Use constants in the test and cover every identity gate:

```js
const PUBLIC_ROOT = 'C:\\Project\\Claude\\happyHome_public'
const PUBLIC_ORIGIN = 'https://github.com/happyhome-project/happyHome_public.git'
const validState = {
  cwd: PUBLIC_ROOT,
  originUrl: PUBLIC_ORIGIN,
  branch: 'main',
  headSha: 'a',
  originMainSha: 'a',
  changedPaths: [],
  releaseStrategy: 'full-current',
  fullCurrentExplicit: true,
}

test('formal release authorizes only explicit full-current on synchronized public main', () => {
  assert.doesNotThrow(() => releasePolicyModule.assertFormalReleaseGitState(validState))
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({ ...validState, cwd: 'C:\\Project\\Claude\\happyHome' }), /canonical/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({ ...validState, originUrl: 'https://github.com/angrybirddd/happyHome.git' }), /public origin/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({ ...validState, branch: 'feature' }), /main/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({ ...validState, changedPaths: ['cloud/functions/admin/index.ts'] }), /clean/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({ ...validState, originMainSha: 'b' }), /origin\/main/i)
  assert.throws(() => releasePolicyModule.assertFormalReleaseGitState({ ...validState, fullCurrentExplicit: false }), /explicit/i)
})
```

Keep the existing publish-resume test, changing only its canonical path/origin and adding `releaseStrategy: 'full-current', fullCurrentExplicit: true`.

Add a static integration assertion that the full-current planner refreshes and invokes the same policy before writing a plan:

```js
const releasePlanCli = readFileSync(new URL('../release-plan.mjs', import.meta.url), 'utf8')
assert.match(releasePlanCli, /if \(fullCurrent\)[\s\S]*?git\(\['fetch',[\s\S]*?assertFormalReleaseGitState/)
assert.match(releasePlanCli, /workspaceHead[\s\S]*?headSha !== workspaceHead/)
```

- [ ] **Step 2: Run the policy test and confirm RED**

Run: `node --test scripts/lib/release-policy.test.mjs`

Expected: FAIL because the current canonical path is private and origin/explicit intent are not validated.

- [ ] **Step 3: Implement exact public identity checks**

In `scripts/lib/release-policy.mjs`:

```js
export const FORMAL_RELEASE_CANONICAL_ROOT = 'C:\\Project\\Claude\\happyHome_public'
export const FORMAL_RELEASE_ORIGIN = 'https://github.com/happyhome-project/happyHome_public.git'

export function assertFormalReleaseGitState({
  cwd,
  canonicalPath = FORMAL_RELEASE_CANONICAL_ROOT,
  originUrl,
  branch,
  headSha,
  originMainSha,
  changedPaths = [],
  publishOnly = false,
  generatedBuildInfoMatches = false,
  releaseStrategy = 'main',
  fullCurrentExplicit = false,
}) {
  if (normalizeWorkspacePath(cwd) !== normalizeWorkspacePath(canonicalPath)) {
    throw new Error(`Formal release must run in the canonical main workspace ${canonicalPath}; got ${cwd || '(missing)'}`)
  }
  if (String(originUrl || '').trim() !== FORMAL_RELEASE_ORIGIN) {
    throw new Error(`Formal release requires public origin ${FORMAL_RELEASE_ORIGIN}; got ${originUrl || '(missing)'}`)
  }
  if (releaseStrategy === 'full-current' && !fullCurrentExplicit) {
    throw new Error('full-current release requires the explicit --full-current flag')
  }
  if (!['main', 'full-current'].includes(releaseStrategy)) {
    throw new Error(`unknown formal release strategy: ${releaseStrategy}`)
  }
  if (branch !== 'main') throw new Error(`Formal release must run on main; got ${branch || '(detached)'}`)
  if (!headSha || !originMainSha || headSha !== originMainSha) {
    throw new Error(`Formal release requires HEAD to equal origin/main; got HEAD=${headSha || 'missing'} origin/main=${originMainSha || 'missing'}`)
  }
  const changed = [...new Set(changedPaths.map((value) => String(value || '').replace(/\\/g, '/')).filter(Boolean))]
  if (!publishOnly) {
    if (changed.length > 0) throw new Error(`Formal release requires a clean worktree; changed: ${changed.join(', ')}`)
    return
  }
  const unexpected = changed.filter((path) => path !== GENERATED_BUILD_INFO_PATH)
  if (unexpected.length > 0) throw new Error(`Formal release resume has unexpected worktree changes: ${unexpected.join(', ')}`)
  if (changed.includes(GENERATED_BUILD_INFO_PATH) && !generatedBuildInfoMatches) {
    throw new Error('Formal release resume build-info does not match the prepared version/desc')
  }
}
```

In `getFormalReleaseGitState`, add:

```js
originUrl: getGitOutput('git remote get-url origin'),
releaseStrategy,
fullCurrentExplicit: hasFlag('full-current'),
```

Pass `releaseStrategy` into `getFormalReleaseGitState` at both formal-release and direct-production call sites. Direct component deploys use `releaseStrategy: 'main'`; they still require public canonical clean synchronized `main`.

In `scripts/release-plan.mjs`, import `assertFormalReleaseGitState` and place this check inside the `fullCurrent` branch before manifest reads or plan output:

```js
git(['fetch', '--quiet', 'origin', 'main'], root)
const workspaceHead = git(['rev-parse', 'HEAD'], root)
if (headSha !== workspaceHead) {
  throw new Error(`full-current plan head must equal workspace HEAD; got head=${headSha} HEAD=${workspaceHead}`)
}
assertFormalReleaseGitState({
  cwd: root,
  originUrl: git(['remote', 'get-url', 'origin'], root),
  branch: git(['branch', '--show-current'], root),
  headSha: workspaceHead,
  originMainSha: git(['rev-parse', 'origin/main'], root),
  changedPaths: git(['status', '--porcelain'], root).split(/\r?\n/).filter(Boolean),
  releaseStrategy: 'full-current',
  fullCurrentExplicit: true,
})
```

This makes full-current planning itself reject the private checkout, feature/detached worktrees, dirty or stale public `main`, wrong origin, and explicit-head drift. Normal `main` and PR planning retain their existing behavior.

- [ ] **Step 4: Run focused policy tests**

Run: `node --test scripts/lib/release-policy.test.mjs scripts/lib/direct-deploy-policy.test.mjs`

Expected: PASS with public canonical, wrong-origin, dirty, stale, feature, and explicit-intent cases covered.

- [ ] **Step 5: Commit authorization policy**

```powershell
git add scripts/lib/release-policy.mjs scripts/lib/release-policy.test.mjs scripts/release-plan.mjs scripts/deploy.mjs
git commit -m "feat: authorize public main releases"
```

### Task 4: Bind prepare and publish to one strategy and exact SHA

**Files:**
- Modify: `scripts/lib/release-run-ledger.mjs:26,137-150,467-505`
- Modify: `scripts/deploy.mjs:996-1014,1122-1175`
- Test: `scripts/lib/release-run-ledger.test.mjs:48-175`
- Test: `scripts/lib/release-policy.test.mjs:158-190`

- [ ] **Step 1: Add failing ledger strategy tests**

Extend the ledger context test:

```js
test('prepared ledger rejects release strategy or exact SHA drift on publish reopen', async () => {
  const root = await tempRoot()
  try {
    await createReleaseRunLedger({
      root,
      runId: 'full-current-run',
      command: 'release-prepare --full-current',
      gitSha: 'public-sha',
      version: '1.0.26071201',
      desc: 'full-current public main',
      envId: 'env-a',
      releaseStrategy: 'full-current',
    })
    await assert.rejects(() => createReleaseRunLedger({
      root,
      runId: 'full-current-run',
      command: 'release-publish',
      gitSha: 'public-sha',
      version: '1.0.26071201',
      desc: 'full-current public main',
      envId: 'env-a',
      releaseStrategy: 'main',
    }), /release run context mismatch.*releaseStrategy/i)
    await assert.rejects(() => createReleaseRunLedger({
      root,
      runId: 'full-current-run',
      command: 'release-publish --full-current',
      gitSha: 'different-sha',
      version: '1.0.26071201',
      desc: 'full-current public main',
      envId: 'env-a',
      releaseStrategy: 'full-current',
    }), /release run context mismatch.*gitSha/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

Add static assertions to the formal release path test that `releaseStrategy` is passed to the ledger and planner, and that `--full-current` is parsed before ledger creation.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test scripts/lib/release-run-ledger.test.mjs scripts/lib/release-policy.test.mjs`

Expected: FAIL because the ledger ignores `releaseStrategy` and deploy does not thread it.

- [ ] **Step 3: Persist strategy in every ledger context comparison**

Change the ledger context keys and creation fields:

```js
const RELEASE_CONTEXT_KEYS = ['gitSha', 'version', 'desc', 'envId', 'releaseStrategy']
```

Add `releaseStrategy: options.releaseStrategy || 'main'` to both the existing-run merge object and new `state.context`. Add the same field to `latest.json` and `summarizeReleaseRun` context output so status evidence remains inspectable.

- [ ] **Step 4: Thread explicit strategy through formal release**

At the beginning of `runFormalRelease`, derive strategy only from the explicit flag:

```js
const fullCurrentExplicit = hasFlag('full-current')
const releaseStrategy = fullCurrentExplicit ? 'full-current' : 'main'
```

Pass both fields to `getFormalReleaseGitState`. Add `releaseStrategy` to `releaseContext` and `createReleaseRunLedger`. Change the planner wrapper to:

```js
function createFormalReleasePlan(gitSha, releaseStrategy) {
  const mode = releaseStrategy === 'full-current' ? 'full-current' : 'main'
  const result = spawnSync(process.execPath, ['scripts/release-plan.mjs', `--mode=${mode}`, `--head=${gitSha}`], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `exit ${result.status}`
    throw new Error(`Formal release plan failed: ${detail}`)
  }
  if (result.stdout) process.stdout.write(result.stdout)
  const planPath = resolve(ROOT, '.codex-local', 'release-plans', `${gitSha}.json`)
  if (!existsSync(planPath)) throw new Error(`Formal release plan did not write ${planPath}`)
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const strategyMatches = releaseStrategy === 'full-current'
    ? plan.planningStrategy === 'full-current'
    : plan.mode === 'main' && ['incremental', 'bootstrap'].includes(plan.planningStrategy)
  if (plan.mode !== mode || !strategyMatches || plan.headSha !== gitSha || !plan.releaseRequired) {
    throw new Error('Formal release plan strategy, SHA, or release requirement does not match the prepared release')
  }
  return plan
}
```

Call it as `createFormalReleasePlan(releaseContext.gitSha, releaseStrategy)`. Existing `createReleaseRunLedger` mismatch handling then rejects prepare/publish flag omission, strategy switching, run ID reuse with another SHA, version, description, or environment before guard acquisition or remote mutation.

- [ ] **Step 5: Run ledger and formal-path tests**

Run: `node --test scripts/lib/release-run-ledger.test.mjs scripts/lib/release-policy.test.mjs scripts/lib/release-plan.test.mjs`

Expected: PASS, including strategy mismatch and exact-SHA mismatch rejection.

- [ ] **Step 6: Commit strategy binding**

```powershell
git add scripts/lib/release-run-ledger.mjs scripts/lib/release-run-ledger.test.mjs scripts/deploy.mjs scripts/lib/release-policy.test.mjs
git commit -m "feat: bind full-current release evidence"
```

### Task 5: Prove existing guarded operations and completion remain mandatory

**Files:**
- Modify: `scripts/lib/release-policy.test.mjs:158-190`
- Modify: `scripts/lib/release-run-ledger.test.mjs:787-900`
- Test: `scripts/lib/release-operations.test.mjs`
- Test: `scripts/lib/production-release-guard.test.mjs`
- Test: `scripts/lib/release-governance.test.mjs`

- [ ] **Step 1: Add assertions for the unchanged formal-release stage chain**

Extend the existing `formal release path records resumable ledger stages before upload` test with:

```js
assert.match(releaseBlock, /executeReleaseOperations/)
assert.match(releaseBlock, /releaseGuard\.acquire\(\)/)
assert.match(releaseBlock, /cloud-version-probes/)
assert.match(releaseBlock, /HH_CLOUD_FIXTURE_CLEANUP_OK|runCloudSmoke/)
assert.match(releaseBlock, /preparedPackageDigest/)
assert.match(releaseBlock, /completeProductionReleaseWithRemoteConfirmation/)
assert(releaseBlock.indexOf("'cloud-smoke'") < releaseBlock.indexOf("'admin-web-deploy'"))
assert(releaseBlock.indexOf("'admin-web-deploy'") < releaseBlock.indexOf("'miniprogram-upload'"))
```

Add `releaseStrategy: 'full-current'` to the remote-confirmation ledger and guard contexts in the exact-SHA completion test. Keep the mismatched remote SHA case and assert that the ledger is not marked passed.

- [ ] **Step 2: Run the guard tests**

Run:

```powershell
node --test scripts/lib/release-policy.test.mjs scripts/lib/release-operations.test.mjs scripts/lib/production-release-guard.test.mjs scripts/lib/release-governance.test.mjs scripts/lib/release-run-ledger.test.mjs
```

Expected: PASS. The tests must show allowlisted actions only, already-applied migrations skipped, every mutation fenced, unresolved failure not converted to success, exact-SHA remote confirmation required, and the local ledger marked passed only after production state proves the same SHA/run ID.

- [ ] **Step 3: Commit the regression proof if assertions changed**

```powershell
git add scripts/lib/release-policy.test.mjs scripts/lib/release-run-ledger.test.mjs
git commit -m "test: preserve full release safety gates"
```

### Task 6: Update repository policy and the local release operator skill

**Files:**
- Modify: `AGENTS.md:8-34`
- Modify: `docs/SETUP.md:64-109`
- Modify: `docs/release-gate.md:1-75`
- Modify outside repository: `X:\Users\86136\.codex\skills\happyhome-release\SKILL.md`

- [ ] **Step 1: Update checked-in authority text**

Make these statements explicit in all three repository documents:

```markdown
- Formal production release runs only from the clean synchronized public canonical `main` at `C:\Project\Claude\happyHome_public` with origin `https://github.com/happyhome-project/happyHome_public.git`.
- A full-current release requires `--full-current` on both prepare and publish. It ignores the previous production SHA only for planning; it never clears or fabricates production state.
- Feature worktrees, dirty/stale main, mismatched SHA/run strategy, missing release lock, failed UI evidence, failed cloud smoke, or failed fixture cleanup block publication.
```

In `docs/release-gate.md`, document the concrete two-stage command shape:

```powershell
$runId = '20260712T-full-current-public-main'
$version = '1.0.26071201'
$desc = 'full-current public main'
node X:\Users\86136\.codex\skills\happyhome-release\scripts\happyhome-release-guard.mjs prepare -- --full-current --release-run-id=$runId --version=$version --desc=$desc
node X:\Users\86136\.codex\skills\happyhome-release\scripts\happyhome-release-guard.mjs publish -- --full-current --resume --release-run-id=$runId --cloud-deploy-concurrency=2 --cloud-smoke-concurrency=3
```

Do not remove the existing UI labels, cloud labels, cleanup rule, digest rule, CloudBase CLI/COS requirement, or upload verification.

- [ ] **Step 2: Verify repository docs before committing**

Run: `npm.cmd run docs:check`

Expected JSON: `missing`, `broken`, and `historicalHeaders` are all empty arrays.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 3: Commit repository documentation**

```powershell
git add AGENTS.md docs/SETUP.md docs/release-gate.md
git commit -m "docs: authorize full-current public releases"
```

- [ ] **Step 4: Update and verify the user-local release skill**

In `X:\Users\86136\.codex\skills\happyhome-release\SKILL.md`, replace the private canonical path with `C:\Project\Claude\happyHome_public`, state that full-current is explicit, and use the same prepare/publish commands shown above. Do not change the skill guard script: it already forwards arguments, requires an explicit run ID for publish, and checked-in release policy remains the mutation authority.

Run:

```powershell
rg -n "happyHome_public|--full-current|prepare|publish" X:\Users\86136\.codex\skills\happyhome-release\SKILL.md
rg -n "C:\\Project\\Claude\\happyHome(?:[^_]|$)" X:\Users\86136\.codex\skills\happyhome-release\SKILL.md
```

Expected: the first command shows the public path and both explicit commands; the second command produces no private canonical-path match. This file is user-local and is not staged in the repository.

### Task 7: Run the complete offline release-policy verification

**Files:**
- Verify only; no new files expected.

- [ ] **Step 1: Run focused release suites**

```powershell
node --test scripts/lib/release-plan.test.mjs scripts/lib/release-plan-base.test.mjs scripts/lib/release-policy.test.mjs scripts/lib/release-run-ledger.test.mjs scripts/lib/release-operations.test.mjs scripts/lib/production-release-guard.test.mjs scripts/lib/release-governance.test.mjs scripts/lib/direct-deploy-policy.test.mjs
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run repository governance and deploy-output suites**

```powershell
npm.cmd run test:governance
npm.cmd run test:deploy-output
npm.cmd run docs:check
git diff --check
```

Expected: every command exits 0; docs report no missing/broken/header problems. These are offline checks and must not deploy, upload, change indexes, or mutate production state.

- [ ] **Step 3: Confirm scope and worktree state**

```powershell
git status --short --branch
git diff origin/main...HEAD --name-only
git log --format="%h %an <%ae> %s" origin/main..HEAD
```

Expected: only the planner, release policy, ledger/deploy orchestration, their tests, the approved spec/plan, and the three authority documents appear; no runtime product feature, generated release evidence, credential, production-state fixture, or deployment artifact is tracked. Every commit author is `AngryBird <48046333+angrybirddd@users.noreply.github.com>`.

- [ ] **Step 4: Stop before production mutation**

Do not run release prepare, publish, cloud deployment, admin deployment, mini-program upload, migration, index action, push, or PR creation as part of implementation verification. Hand the clean committed feature branch back for PR review, CI, and Merge Queue before any formal release from updated public `main`.
