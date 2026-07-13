# Shared Web H5 Test Tenant Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-13 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current `AGENTS.md`, H5 preview runbook, runtime code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing uni-app H5 build to the real CloudBase backend through native Web authentication, then give every worktree a stable hidden test community shared with the real WeChat validation identity.

**Architecture:** Preserve the existing `callCloud` business API and select only the transport by runtime: `wx.cloud` for the mini-program and one authenticated `@cloudbase/js-sdk` singleton for H5. Cloud functions derive identities only from trusted runtime context. A small manifest-driven CLI provisions and diagnoses one hidden test tenant; ordinary H5 runs are concurrent and lease-free, while provisioning remains lease-guarded.

**Tech Stack:** Vue 3, uni-app, Pinia, TypeScript, CloudBase Web SDK, wx-server-sdk, Node.js 24, Vitest, Jest, Node test runner, Playwright.

---

## File Map

- `cloud/lib/ctx.ts`: trusted WeChat/Web caller resolution.
- `cloud/lib/__tests__/ctx.test.ts`: identity namespace and anonymous rejection.
- `cloud/shared/types.ts`: optional community discoverability metadata.
- `cloud/functions/community/index.ts`: user-directory filtering.
- `cloud/functions/community/__tests__/community.test.ts`: hidden/member/admin behavior.
- `miniprogram/src/api/web-cloudbase.ts`: H5 SDK singleton, auth, function, and storage primitives.
- `miniprogram/src/api/cloud.ts`: runtime transport selection and normalized business calls.
- `miniprogram/src/api/storage.ts`: cross-runtime upload/temp-URL boundary.
- `miniprogram/src/api/__tests__/web-cloudbase.test.ts`: Web SDK contract tests.
- `miniprogram/src/api/__tests__/cloud.test.ts`: unchanged mini-program routing plus H5 routing.
- `miniprogram/src/api/__tests__/storage.test.ts`: upload and URL normalization.
- `miniprogram/src/store/user.ts`: Web session login, restore, and logout ordering.
- `miniprogram/src/store/__tests__/user-web-auth.test.ts`: session-state behavior.
- `miniprogram/src/pages/profile/index.vue`: H5 username/password UI; mini-program profile stays unchanged.
- `miniprogram/src/pages/create/index.vue`, `miniprogram/src/store/audio.ts`: use the storage boundary.
- `scripts/lib/h5-test-tenant.mjs`: pure manifest, inspection, diff, and validation logic.
- `scripts/lib/h5-test-tenant.test.mjs`: provision/doctor unit tests with fake stores.
- `scripts/h5-test-tenant.mjs`: `prepare`, `apply`, and `doctor` CLI.
- `scripts/h5-web.mjs`: starts the current worktree H5 with shared public CloudBase configuration.
- `scripts/test-h5-web-smoke.mjs`: real-browser read/write smoke after provisioning.
- `package.json`, `miniprogram/package.json`, `package-lock.json`: commands and Web SDK dependency.
- `docs/h5-preview-runbook.md`: maintained operating instructions.

### Task 1: Hide the Shared Test Community

**Files:**
- Modify: `cloud/shared/types.ts`
- Modify: `cloud/functions/community/index.ts`
- Test: `cloud/functions/community/__tests__/community.test.ts`

- [ ] **Step 1: Add failing directory tests**

Add tests proving ordinary `list` and `listDiscoverable` omit `{ discoverable: false }`, while `includeAll` and membership-based paths remain unchanged.

```ts
expect((await handleList({}, 'viewer')).communities.map((x: any) => x._id)).toEqual(['public'])
expect((await handleListDiscoverable('viewer')).communities.map((x: any) => x._id)).toEqual(['public'])
expect((await handleList({ includeAll: true }, 'super-admin')).communities.map((x: any) => x._id)).toContain('hidden')
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand functions/community/__tests__/community.test.ts`

Expected: hidden community is still returned by ordinary calls.

- [ ] **Step 3: Implement the minimal filter**

Add `discoverable?: boolean` to `Community` and filter only ordinary directory results:

```ts
function isDiscoverableCommunity(community: Community) {
  return community.discoverable !== false
}
```

Do not filter `includeAll`; do not change `member.myCommunities`.

- [ ] **Step 4: Run focused cloud tests and commit**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand functions/community/__tests__/community.test.ts`

Expected: PASS.

Commit: `feat: support hidden test communities`

### Task 2: Resolve Trusted Web Identities

**Files:**
- Modify: `cloud/lib/ctx.ts`
- Create: `cloud/lib/__tests__/ctx.test.ts`
- Modify: `cloud/functions/user/index.ts`
- Modify: `cloud/functions/community/index.ts`
- Modify: `cloud/functions/member/index.ts`
- Modify: `cloud/functions/section/index.ts`
- Modify: `cloud/functions/post/index.ts`

- [ ] **Step 1: Write failing identity tests**

Mock `wx-server-sdk.getWXContext()` and `@cloudbase/node-sdk.getCloudbaseContext()` and assert:

```ts
expect(resolveOpenId({}, { WX_OPENID: 'wx-user' })).toBe('wx-user')
expect(resolveOpenId({}, { TCB_UUID: 'web-user', TCB_ISANONYMOUS_USER: 'false' })).toBe('web:web-user')
expect(() => resolveOpenId({}, { TCB_UUID: 'anon', TCB_ISANONYMOUS_USER: 'true' })).toThrow('Authenticated caller required')
```

Also retain a test proving `_testOpenid` is ignored unless the existing test-only flag is explicitly enabled.

- [ ] **Step 2: Run and confirm RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand lib/__tests__/ctx.test.ts`

Expected: current resolver returns only WeChat OPENID.

- [ ] **Step 3: Implement one resolver signature**

```ts
type CallerContext = { WX_OPENID?: string; TCB_UUID?: string; TCB_ISANONYMOUS_USER?: string }
export function resolveOpenId(event: any, context?: CallerContext): string
```

Prefer trusted WeChat identity, otherwise require a non-anonymous TCB UUID and prefix it with `web:`. Update the five function entrypoints to accept `(event, context)` and pass context to the resolver. No client field may select the identity.

- [ ] **Step 4: Run cloud unit/build checks and commit**

Run:

```powershell
npm.cmd --workspace cloud run test:unit -- --runInBand lib/__tests__/ctx.test.ts functions/user/__tests__/login.test.ts functions/community/__tests__/community.test.ts functions/member/__tests__/member.test.ts
npm.cmd --workspace cloud run build
```

Expected: PASS.

Commit: `feat: authenticate CloudBase Web callers`

### Task 3: Add the H5 CloudBase Runtime

**Files:**
- Create: `miniprogram/src/api/web-cloudbase.ts`
- Create: `miniprogram/src/api/__tests__/web-cloudbase.test.ts`
- Modify: `miniprogram/src/api/cloud.ts`
- Modify: `miniprogram/src/api/__tests__/cloud.test.ts`
- Modify: `miniprogram/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the pinned Web SDK**

Run: `npm.cmd install --workspace miniprogram @cloudbase/js-sdk@3.6.2`

- [ ] **Step 2: Write failing Web runtime tests**

Tests inject a fake SDK and prove one singleton, explicit configuration failure, login-state lookup, sign-in/out, and `callFunction({ name, data })` routing. The H5 `cloud.test.ts` case must expect Web SDK transport and must not expect an HTTP request or test OpenID header.

```ts
await webCloud.signIn('hh_web_test', 'StrongPassword')
await webCloud.callFunction('post', { action: 'bootstrap' })
expect(fakeApp.callFunction).toHaveBeenCalledWith({ name: 'post', data: { action: 'bootstrap' } })
```

- [ ] **Step 3: Run and confirm RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- src/api/__tests__/web-cloudbase.test.ts src/api/__tests__/cloud.test.ts`

Expected: module missing or H5 still targets `http-gateway`.

- [ ] **Step 4: Implement the Web singleton and transport switch**

`web-cloudbase.ts` reads only public `VITE_CLOUDBASE_ENV_ID` and `VITE_CLOUDBASE_ACCESS_KEY`, initializes once, and exports `getLoginState`, `signIn`, `signOut`, and `callFunction`. `cloud.ts` keeps the mini-program path unchanged and uses the singleton only in H5 conditional compilation.

Delete H5 bearer-token and test-openid request behavior from normal client execution.

- [ ] **Step 5: Run focused tests, H5 build, mini-program build, and commit**

Run:

```powershell
npm.cmd --workspace miniprogram run test:unit -- src/api/__tests__/web-cloudbase.test.ts src/api/__tests__/cloud.test.ts
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: PASS and the mini-program build does not require Web credentials.

Commit: `feat: route H5 through CloudBase Web SDK`

### Task 4: Replace Fake H5 Login With Real Web Sessions

**Files:**
- Modify: `miniprogram/src/store/user.ts`
- Create: `miniprogram/src/store/__tests__/user-web-auth.test.ts`
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: `miniprogram/src/App.vue`

- [ ] **Step 1: Write failing store tests**

Prove sign-in happens before `user.login`, an expired SDK session clears stale Pinia state, failed sign-in leaves no partial user state, and logout calls CloudBase sign-out before local cleanup.

```ts
await store.webLogin({ username: 'hh_web_test', password: 'secret', nickName: 'H5 测试用户' })
expect(order).toEqual(['web.signIn', 'user.login'])
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- src/store/__tests__/user-web-auth.test.ts`

Expected: `webLogin` and `restoreWebSession` do not exist.

- [ ] **Step 3: Implement H5 auth actions and UI**

Add `webLogin`, `restoreWebSession`, and async `logout`. Remove the H5 fake OpenID form and render username/password fields only under `#ifdef H5`; preserve the current mini-program profile collection flow under `#ifdef MP-WEIXIN`.

At app launch, restore the Web SDK session before trusting stored business state. Show provider errors directly and never write passwords to Pinia persistence.

- [ ] **Step 4: Run tests/builds and commit**

Run:

```powershell
npm.cmd --workspace miniprogram run test:unit -- src/store/__tests__/user-web-auth.test.ts src/utils/__tests__/profile-debug-visibility.test.ts
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: PASS.

Commit: `feat: add persistent H5 Web login`

### Task 5: Normalize Existing Storage Workflows

**Files:**
- Create: `miniprogram/src/api/storage.ts`
- Create: `miniprogram/src/api/__tests__/storage.test.ts`
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: `miniprogram/src/store/audio.ts`

- [ ] **Step 1: Write failing storage tests**

Cover `wx.cloud.uploadFile` routing, H5 Blob/File upload routing, normalized progress, temporary URL resolution, and explicit errors for unsupported local sources.

```ts
expect(await uploadCloudFile({ cloudPath: 'qa/a.jpg', source: file })).toEqual({ fileID: 'cloud://qa/a.jpg' })
expect(await getCloudTempUrls(['cloud://a'])).toEqual([{ fileID: 'cloud://a', tempFileURL: 'https://example/a' }])
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- src/api/__tests__/storage.test.ts`

- [ ] **Step 3: Implement and adopt the adapter**

Keep platform selection inside `storage.ts`. Replace the three direct `wx.cloud` storage calls without changing page business behavior. H5 converts browser blob URLs to Blob/File before upload; mini-program continues to pass file paths.

- [ ] **Step 4: Run focused tests/type-check/builds and commit**

Run:

```powershell
npm.cmd --workspace miniprogram run test:unit -- src/api/__tests__/storage.test.ts
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: PASS.

Commit: `feat: support CloudBase storage in H5`

### Task 6: Build the Manifest-Driven Test Tenant CLI

**Files:**
- Create: `scripts/lib/h5-test-tenant.mjs`
- Create: `scripts/lib/h5-test-tenant.test.mjs`
- Create: `scripts/h5-test-tenant.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing pure planner tests**

Define the fixed manifest (`fixtureKey`, hidden community metadata, three sections, 30/1/0 posts) and fake-store cases for empty state, exact state, drift, unknown conflicting records, forbidden real-community membership, and idempotent second apply.

```js
const plan = await prepareH5TestTenant({ store: fakeStore(), manifest: H5_TEST_TENANT_MANIFEST })
assert.deepEqual(plan.counts, { communities: 1, sections: 3, posts: 31, webMembers: 1 })
assert.equal((await applyH5TestTenant({ store, plan })).changed, true)
assert.equal((await applyH5TestTenant({ store, plan: await prepareH5TestTenant({ store, manifest }) })).changed, false)
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test scripts/lib/h5-test-tenant.test.mjs`

- [ ] **Step 3: Implement pure model and guarded CLI**

Commands:

```text
npm.cmd run h5:test-tenant -- prepare
$env:HAPPYHOME_FIXTURE_PREFIX='HH_WEB_H5_V1'; npm.cmd run env:run -- --profile=fixture-write -- node scripts/h5-test-tenant.mjs apply --manifest=.codex-local/h5-test-tenant/prepare.json
npm.cmd run h5:test-tenant -- doctor
```

The CLI reads `HH_H5_WEB_USERNAME`, `HH_H5_WEB_PASSWORD`, and `HH_WECHAT_TEST_OPENID` from `~/.happyhome/h5-web.env`. It uses existing CAM loading plus CloudBase manager/database clients to create the end user and exact manifest records, writes prepare manifests under `.codex-local/`, verifies exact environment and plan identity on apply, and refuses unknown deletes or arbitrary fixture keys. No command prints credentials or OpenIDs.

- [ ] **Step 4: Add CLI policy tests and package scripts**

Add `h5:test-tenant` and include the new test file in `test:governance`. Prove `apply` refuses execution without the `fixture-write` wrapper marker/prefix and that `doctor` is read-only.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test scripts/lib/h5-test-tenant.test.mjs
npm.cmd run test:governance
```

Expected: PASS with no network access in unit tests.

Commit: `feat: add shared Web H5 test tenant tooling`

### Task 7: Add Real H5 Doctor and Browser Smoke

**Files:**
- Create: `scripts/test-h5-web-smoke.mjs`
- Create: `scripts/h5-web.mjs`
- Create: `scripts/lib/h5-web-smoke-policy.test.mjs`
- Modify: `package.json`
- Modify: `docs/h5-preview-runbook.md`

- [ ] **Step 1: Write failing policy tests**

Require machine-local credentials, OS-selected port, exact cwd/branch/HEAD evidence, login through visible H5 UI, real homepage/section/detail/profile reads, one uniquely named controlled create/upload record, exact cleanup, and sanitized evidence.

- [ ] **Step 2: Run and confirm RED**

Run: `node --test scripts/lib/h5-web-smoke-policy.test.mjs`

- [ ] **Step 3: Implement the smoke and runbook**

`h5-web.mjs` reads the shared machine file, exports only the public environment ID/access key to Vite, and starts the current worktree on an available port. The smoke fills credentials from the same machine file, runs `doctor`, exercises the real UI, records geometry and sanitized IDs, and cleans only records it created. Its controlled create/upload phase acquires the validation lease; its read-only phase remains lease-free. It never kills a process by port and never edits the baseline.

- [ ] **Step 4: Run static/local verification and commit**

Run:

```powershell
node --test scripts/lib/h5-web-smoke-policy.test.mjs
npm.cmd run docs:check
git diff --check
```

Expected: PASS.

Commit: `test: add real Web H5 validation flow`

### Task 8: Full Verification, PR, and Post-Merge Provision

**Files:**
- Modify only if verification exposes an in-scope defect.

- [ ] **Step 1: Run the complete offline PR contract**

```powershell
npm.cmd --workspace cloud test
npm.cmd --workspace cloud run build
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
npm.cmd run test:deploy-output
npm.cmd run docs:check
npm.cmd run test:governance
git diff --check origin/main...HEAD
```

- [ ] **Step 2: Fetch and merge latest main if required**

Run `git fetch origin main`; if HEAD lacks `origin/main`, merge it in this worktree, rerun affected tests, and never rebase or auto-stash.

- [ ] **Step 3: Push and open the feature PR**

Push `codex/h5-test-tenant`, open a non-draft PR with scope, tests, cloud deployment targets, auth configuration, data fixture plan, and acceptance steps. Monitor exact-head CI/reviews until merge-ready, then continue monitoring through Merge Queue terminal state.

- [ ] **Step 4: Provision only after merge from canonical main**

From clean synchronized `C:\Project\Claude\happyHome_public`, run read-only `prepare`, inspect the exact plan, then run the leased `apply`. Do not deploy or publish from the feature worktree.

- [ ] **Step 5: Run real acceptance**

Run the H5 doctor from two worktrees concurrently, then the real H5 smoke. Finally acquire the DevTools lease and verify the same community with the real WeChat member. Report `implemented`, `merged`, `provisioned`, and `validated` separately according to evidence.
