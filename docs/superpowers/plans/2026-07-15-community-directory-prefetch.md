# Community Directory Prefetch Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-15 implementation sequence. Retain it for traceability; do not treat task checkboxes as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current mini-program source, tests, and release gates.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Profile creation navigate directly to the creation page and make the join-community directory render from a per-user prewarmed cache before its single cloud refresh completes.

**Architecture:** Add one focused stale-while-revalidate directory cache with per-user storage, five-minute freshness, six-hour hard expiry, in-flight request deduplication, and identity epochs. Prime it without awaiting from login/session/Profile paths, then let onboarding synchronously seed cards from Store plus cache and use the cache loader for its only directory request.

**Tech Stack:** Vue 3, uni-app, Pinia, TypeScript, Vitest, WeChat mini-program build.

---

### Task 1: Build the per-user directory cache with TDD

**Files:**
- Create: `miniprogram/src/utils/community-directory-cache.ts`
- Create: `miniprogram/src/utils/__tests__/community-directory-cache.test.ts`

- [ ] **Step 1: Write failing cache tests**

Create tests that install an in-memory `uni` storage mock and cover the public API below:

```ts
const first = await loadCommunityDirectory({
  openId: 'user-a',
  now: () => 1_000,
  fetcher,
})
expect(first.communities.map((item) => item._id)).toEqual(['c1'])
expect(readCommunityDirectoryCache('user-a', 1_000 + 4 * 60_000)?.freshness).toBe('fresh')
expect(readCommunityDirectoryCache('user-a', 1_000 + 10 * 60_000)?.freshness).toBe('stale')
expect(readCommunityDirectoryCache('user-a', 1_000 + 6 * 60 * 60_000 + 1)).toBeNull()
```

Add separate tests proving that two concurrent loads call `fetcher` once, `user-a` data cannot be read as `user-b`, and `clearCommunityDirectoryCache('user-a')` prevents an already-started response from being persisted.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd --prefix miniprogram run test:unit -- src/utils/__tests__/community-directory-cache.test.ts
```

Expected: FAIL because `community-directory-cache.ts` does not exist.

- [ ] **Step 3: Implement the minimal cache module**

Export these stable interfaces:

```ts
export const COMMUNITY_DIRECTORY_FRESH_MS = 5 * 60 * 1000
export const COMMUNITY_DIRECTORY_MAX_STALE_MS = 6 * 60 * 60 * 1000

export type CommunityDirectoryCacheRead = {
  communities: DirectoryCommunity[]
  fetchedAt: number
  freshness: 'fresh' | 'stale'
}

export type CommunityDirectoryFetcher = (
  trace: PerformanceTrace,
) => Promise<{ communities: DirectoryCommunity[] }>

export function readCommunityDirectoryCache(
  openId: string,
  now?: number,
): CommunityDirectoryCacheRead | null

export function clearCommunityDirectoryCache(openId: string): void

export function loadCommunityDirectory(options: {
  openId: string
  force?: boolean
  now?: () => number
  traceStage?: string
  fetcher?: CommunityDirectoryFetcher
}): Promise<CommunityDirectoryCacheRead>

export function primeCommunityDirectory(
  openId: string,
  traceStage?: string,
): Promise<CommunityDirectoryCacheRead>
```

Use storage key `community_directory_cache_v1:<openId>`. Normalize persisted data by requiring schema version `1`, an exact viewer identity match, a finite timestamp, and active community records with non-empty `_id`. Return fresh cache without a request; return stale cache immediately only through the synchronous reader, while `loadCommunityDirectory` refreshes it. Capture a per-user epoch before fetching and write only if the epoch is still current. Reuse the same per-user Promise before considering `force` so pull-to-refresh cannot duplicate an active request.

The default fetcher must call:

```ts
communityApi.listDiscoverable({
  requestId: createPerformanceRequestId('community-directory'),
  stage: options.traceStage || 'community.directory',
  sample: cached ? 'warm' : 'cold',
  counts: { cachedCommunityCount: cached?.communities.length || 0 },
})
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: all cache tests PASS.

- [ ] **Step 5: Commit the cache unit**

```powershell
git add -- miniprogram/src/utils/community-directory-cache.ts miniprogram/src/utils/__tests__/community-directory-cache.test.ts
git commit -m "feat(mp): cache community directory by user"
```

### Task 2: Prime after authentication and at foreground opportunities

**Files:**
- Modify: `miniprogram/src/store/user.ts`
- Modify: `miniprogram/src/store/__tests__/user-web-auth.test.ts`
- Modify: `miniprogram/src/App.vue`
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`

- [ ] **Step 1: Write failing login and lifecycle tests**

Mock the cache module in `user-web-auth.test.ts`:

```ts
const primeCommunityDirectory = vi.fn()
const clearCommunityDirectoryCache = vi.fn()

vi.mock('../../utils/community-directory-cache', () => ({
  primeCommunityDirectory,
  clearCommunityDirectoryCache,
}))
```

Add a direct-login test where `primeCommunityDirectory` returns a never-settling Promise, then verify `store.login(...)` still resolves, applies the user, and calls `primeCommunityDirectory('web-user-1', 'community.directory.login-prefetch')`. Add a logout test asserting the old `openId` is passed to `clearCommunityDirectoryCache` before local identity is emptied.

Extend the static page contract to require non-awaited prime calls in `App.vue` foreground handling and Profile `onShow`, and to require both calls to catch and log failures without showing a Toast.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd --prefix miniprogram run test:unit -- src/store/__tests__/user-web-auth.test.ts src/utils/__tests__/community-pages-figma.test.ts
```

Expected: FAIL because authentication and lifecycle code do not call the cache module.

- [ ] **Step 3: Implement non-blocking prime and identity cleanup**

In `user.ts`, add focused helpers:

```ts
function primeDirectoryAfterLogin(openId: string) {
  const id = String(openId || '').trim()
  if (!id) return
  void primeCommunityDirectory(id, 'community.directory.login-prefetch').catch((error) => {
    console.warn('[community-directory] login prefetch failed', error)
  })
}
```

Call the helper immediately after each successful login/session state save without awaiting it. In `clearLocalSession`, capture `const previousOpenId = this.openId` before clearing fields and call `clearCommunityDirectoryCache(previousOpenId)` when non-empty.

In `App.vue`, after `sessionReady` and only for a logged-in user, start:

```ts
void primeCommunityDirectory(userStore.openId, 'community.directory.app-prefetch').catch((error) => {
  clientLog('warn', 'app.communityDirectory.prefetch.fail', { error })
})
```

Do not await this Promise. In Profile `onShow`, start the same operation with stage `community.directory.profile-prefetch` before `refreshProfileData('show')`; log failure through the existing profile logger.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused Vitest command. Expected: all tests PASS and the pending prime Promise does not delay login.

- [ ] **Step 5: Commit prewarm integration**

```powershell
git add -- miniprogram/src/store/user.ts miniprogram/src/store/__tests__/user-web-auth.test.ts miniprogram/src/App.vue miniprogram/src/pages/profile/index.vue miniprogram/src/utils/__tests__/community-pages-figma.test.ts
git commit -m "perf(mp): prewarm community directory"
```

### Task 3: Make onboarding cache-first and route creation directly

**Files:**
- Modify: `miniprogram/src/pages/onboarding/index.vue`
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: `miniprogram/src/utils/__tests__/community-pages-figma.test.ts`

- [ ] **Step 1: Write failing page contracts**

Add assertions that Profile binds the create card to `goCreateCommunity`, whose body navigates to `/pages/createCommunity/index`, while the join card remains bound to `goOnboarding`.

For onboarding, extract the `refreshOnboardingData` source block and assert:

```ts
expect(refresh).toContain('readCommunityDirectoryCache')
expect(refresh).toContain('communityStore.myCommunities')
expect(refresh).toContain('loadCommunityDirectory({')
expect(refresh).not.toContain('communityStore.loadMyCommunities')
expect(refresh).not.toContain('await resolveCommunityCovers')
expect(refresh).toContain('directoryLoadEpoch')
expect(source).toContain('加载较慢')
expect(source).toContain('@tap="retryDirectoryLoad"')
```

Also assert that latest `viewerStatus === 'active'` drives share-target and auto-mode redirects rather than cached membership alone.

- [ ] **Step 2: Run the page contract and verify RED**

```powershell
npm.cmd --prefix miniprogram run test:unit -- src/utils/__tests__/community-pages-figma.test.ts
```

Expected: FAIL because Profile still shares one handler and onboarding still awaits `loadMyCommunities` before the directory.

- [ ] **Step 3: Implement direct creation routing**

Change only the create card binding and add:

```ts
function goCreateCommunity() {
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}
```

Keep `goOnboarding()` unchanged for join and all other discover flows.

- [ ] **Step 4: Implement cache-first onboarding refresh**

Add `loading`, `slowLoading`, `loadError`, and `directoryLoadEpoch` state. At the start of each logged-in refresh:

```ts
const requestedOpenId = String(userStore.openId || '')
const cached = readCommunityDirectoryCache(requestedOpenId)
communities.value = prioritizeShareTargetCommunities(
  mergeCommunityDirectory(
    communityStore.myCommunities,
    cached?.communities || communities.value,
  ),
  targetCommunityId.value,
)
```

Then start a five-second slow timer and await one `loadCommunityDirectory({ openId: requestedOpenId, force, traceStage: 'community.directory.onboarding' })`. Before applying, require both the captured page epoch and `userStore.openId === requestedOpenId`. Merge the returned directory with Store, update cards, and call `void resolveCommunityCovers(communities.value)`.

Use latest returned directory entries for these redirects:

```ts
const joinedTarget = targetCommunityId.value && latest.some(
  (community) => community._id === targetCommunityId.value && community.viewerStatus === 'active',
)
const activeViewerCount = latest.filter((community) => community.viewerStatus === 'active').length
```

On failure retain existing cards, set `loadError`, and expose `retryDirectoryLoad()` with `force: true`. Render loading, slow-loading, and retry states without hiding already available cards. Pull-down refresh also uses `force: true`. Remove `communityStore.loadMyCommunities()` from the page refresh path.

- [ ] **Step 5: Run page tests and verify GREEN**

Run the same page-contract Vitest command. Expected: PASS.

- [ ] **Step 6: Commit routing and onboarding behavior**

```powershell
git add -- miniprogram/src/pages/onboarding/index.vue miniprogram/src/pages/profile/index.vue miniprogram/src/utils/__tests__/community-pages-figma.test.ts
git commit -m "perf(mp): render join directory from prewarmed cache"
```

### Task 4: Full offline verification and real UI check

**Files:**
- Verify only; modify production code only through a new failing regression test if a defect is found.

- [ ] **Step 1: Run all mini-program unit tests**

```powershell
npm.cmd --prefix miniprogram run test:unit
```

Expected: all test files and tests PASS.

- [ ] **Step 2: Run type-check and mini-program build**

```powershell
npm.cmd --prefix miniprogram run type-check
npm.cmd --prefix miniprogram run build:mp-weixin
```

Expected: both commands exit `0`.

- [ ] **Step 3: Run repository checks**

```powershell
npm.cmd run docs:check
git diff --check
git status --short --branch
```

Expected: docs have no missing/broken authority metadata, diff check is empty, and status contains only intended branch changes or is clean after commits.

- [ ] **Step 4: Validate in DevTools under a validation lease**

Build the worktree mini-program and use the existing release-safe DevTools tooling without deploying, uploading, or creating fixtures. Verify that the create card opens `/pages/createCommunity/index` directly and that a warmed join page shows at least one cached/Store card before a deliberately deferred directory refresh completes. Record click-to-first-interactive-card timing; acceptance is at most 500ms with cache.

If the local DevTools execution context is unavailable, report that boundary without weakening offline gates or changing production/shared cloud state.

- [ ] **Step 5: Final review**

Inspect `git log`, `git diff origin/main...HEAD`, commit authors, and test evidence. Do not deploy, upload, merge, enqueue, or push until explicitly requested by the user or the repository PR workflow.
