# Archive User-Visible Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace evergreen section navigation with an indexed topic-driven archive feed, expose Xiaohongshu-style image/text publishing plus realtime collaboration, migrate legacy evergreen posts safely, and add administrator topic controls.

**Architecture:** `posts` remains the source of truth. `archive_topics` is the canonical community topic directory and `archive_post_topics` is a deterministic query projection. Native archive posts are section-free; migrated evergreen posts retain `sectionId` only for legacy detail rendering. The home bootstrap returns topic tabs and the first archive page; later pages use stable cursors.

**Tech Stack:** TypeScript, WeChat Cloud Functions/CloudBase, Vue 3 + uni-app, Vue 3 + Element Plus admin web, Jest, Vitest, Node test runner.

---

### Task 1: Archive topic domain and deterministic query projection

**Files:**
- Create: `cloud/shared/archive-topics.ts`
- Create: `cloud/shared/__tests__/archive-topics.test.ts`
- Create: `cloud/lib/archive-topic-index.ts`
- Create: `cloud/lib/__tests__/archive-topic-index.test.ts`
- Modify: `cloud/lib/db.ts`
- Modify: `cloud/lib/__tests__/db.test.ts`

- [ ] **Step 1: Write failing normalization, precedence, cursor, and deterministic-ID tests**

Test these exported contracts:

```ts
normalizeArchiveTopic(' #亲子出游 ') // { topicKey: '亲子出游', displayName: '亲子出游' }
selectArchiveTabs(topics, 7) // legacy order, then admin order, then recentScore
encodeArchiveCursor({ sortKey: '...', postId: 'post-1' })
decodeArchiveCursor(cursor)
archivePostTopicId('post-1', '亲子出游') // stable across retries
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand shared/__tests__/archive-topics.test.ts lib/__tests__/archive-topic-index.test.ts lib/__tests__/db.test.ts`
Expected: FAIL because the new modules and cursor query helper do not exist.

- [ ] **Step 3: Implement the domain and DB boundary**

Export these exact types and functions:

```ts
export type ArchiveTopicOrigin = 'legacy' | 'admin' | 'organic'
export type ArchiveTopicRecord = {
  communityId: string; topicKey: string; displayName: string
  origins: ArchiveTopicOrigin[]; enabled: boolean
  legacyOrder?: number; adminOrder?: number
  recentScore: number; recentPostCount: number
  legacySectionId?: string; createdAt: string; updatedAt: string
}
export function normalizeArchiveTopic(value: unknown): { topicKey: string; displayName: string }
export function selectArchiveTabs(records: ArchiveTopicRecord[], limit?: number): ArchiveTopicRecord[]
export function archivePostTopicId(postId: string, topicKey: string): string
export function encodeArchiveCursor(value: { sortKey: string; postId: string }): string
export function decodeArchiveCursor(value?: string): { sortKey: string; postId: string } | null
```

Add a DB adapter query that accepts an explicit range condition without leaking the SDK command object outside `db.ts`:

```ts
export async function queryBefore(
  collectionName: string,
  where: Record<string, unknown>,
  field: string,
  before: string | null,
  limit: number,
)
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.
Expected: all selected suites pass.

- [ ] **Step 5: Commit**

```powershell
git add cloud/shared/archive-topics.ts cloud/shared/__tests__/archive-topics.test.ts cloud/lib/archive-topic-index.ts cloud/lib/__tests__/archive-topic-index.test.ts cloud/lib/db.ts cloud/lib/__tests__/db.test.ts
git commit -m "feat(posts): add archive topic index domain"
```

### Task 2: Indexed archive tabs, feed, and lifecycle

**Files:**
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/lib/__tests__/content-audit.test.ts`
- Modify: `cloud/shared/types.ts`

- [ ] **Step 1: Write failing post API tests**

Cover:

```ts
handleListArchiveTabs({ communityId }, openid)
handleListArchive({ communityId, topicKey: '亲子出游', cursor, limit: 20 }, openid)
```

Assert `全部` is always first, only seven topic tabs follow, topic queries use `archive_post_topics`, cursors are stable, deleted/rejected posts are excluded, and author enrichment preserves projection order.

- [ ] **Step 2: Write failing lifecycle tests**

For native archive create, audit pass/reject, delete, and already-deleted compensation, assert deterministic `archive_topics` and `archive_post_topics` writes are created or invalidated in the same logical lifecycle. Preserve legacy realtime/evergreen behavior.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand functions/post/__tests__/post.test.ts lib/__tests__/content-audit.test.ts`
Expected: FAIL on missing actions and projection writes.

- [ ] **Step 4: Implement tabs and cursor feed**

Extend the handler dispatch with `listArchiveTabs`. Change `listArchive` to accept:

```ts
{
  communityId: string
  topicKey?: string
  cursor?: string
  limit?: number
  asGuest?: boolean
}
```

Return:

```ts
{ posts: Post[]; nextCursor: string; hasMore: boolean }
```

Use posts directly for `全部`; use `archive_post_topics` plus batched post hydration for a topic. Never scan batches or filter topics in memory.

- [ ] **Step 5: Implement projection lifecycle**

Native create upserts organic topics and pending/pass projection rows. Audit callbacks switch projection audit status. Delete marks projection rows deleted. Use deterministic document IDs so retries are idempotent.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run Step 3.
Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add cloud/functions/post/index.ts cloud/functions/post/__tests__/post.test.ts cloud/lib/content-audit.ts cloud/lib/__tests__/content-audit.test.ts cloud/shared/types.ts
git commit -m "feat(posts): add indexed archive topic feeds"
```

### Task 3: Legacy evergreen migration and production declarations

**Files:**
- Create: `scripts/lib/archive-migration.mjs`
- Create: `scripts/lib/archive-migration.test.mjs`
- Create: `scripts/migrate-archive-posts.mjs`
- Modify: `scripts/ensure-indexes.mjs`
- Modify: `scripts/lib/ensure-indexes.test.mjs`
- Create: `release/changes/20260714-archive-user-visible.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing migration plan tests**

Given realtime and evergreen sections, assert only evergreen sections produce legacy topics and post updates:

```js
planArchiveMigration({ sections, posts })
// { topicUpserts, postUpdates, topicLinks, skippedRealtime, warnings }
```

Run the plan twice and assert identical deterministic IDs and no duplicate topic links. Cover posts with existing topics and posts with missing card media.

- [ ] **Step 2: Write failing index/release tests**

Require collections `archive_topics` and `archive_post_topics`, plus compound indexes for tab ordering and topic feed ordering. Require the change manifest to declare post/admin cloud targets, admin web, miniprogram, indexes, and the explicit migration action.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test scripts/lib/archive-migration.test.mjs scripts/lib/ensure-indexes.test.mjs scripts/lib/release-plan.test.mjs`
Expected: FAIL because migration and declarations are absent.

- [ ] **Step 4: Implement dry-run-first migration**

The CLI must require `--community-id`, default to dry-run, require `--apply` for writes, process bounded batches, and print sanitized counts plus failing IDs. It must never archive/delete sections. Add `npm.cmd run migrate:archive-posts -- --community-id=<id>`.

- [ ] **Step 5: Implement index and release declarations**

Declare at least:

```js
['communityId', 'enabled', 'legacyOrder']
['communityId', 'enabled', 'adminOrder']
['communityId', 'enabled', 'recentScore']
['communityId', 'topicKey', 'status', 'auditStatus', 'sortKey']
```

- [ ] **Step 6: Run tests and verify GREEN**

Run Step 3.
Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/lib/archive-migration.mjs scripts/lib/archive-migration.test.mjs scripts/migrate-archive-posts.mjs scripts/ensure-indexes.mjs scripts/lib/ensure-indexes.test.mjs release/changes/20260714-archive-user-visible.json package.json
git commit -m "feat(posts): add archive migration tooling"
```

### Task 4: Section-free archive RAG compatibility

**Files:**
- Modify: `cloud/lib/post-rag-indexing.ts`
- Modify: `cloud/lib/post-rag.ts`
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: matching tests under `cloud/lib/__tests__/` and `cloud/functions/post/__tests__/post.test.ts`

- [ ] **Step 1: Write failing tests**

Assert an audit-passed native archive post produces an index document with `communityId`, `postId`, `area: 'archive'`, `topics`, and no required `sectionId`. Assert delete/reject removes it. Assert realtime behavior remains unchanged and search can return archive evidence without inventing a section.

- [ ] **Step 2: Run focused RAG tests and verify RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand lib/__tests__/post-rag-indexing.test.ts lib/__tests__/post-rag.test.ts lib/__tests__/content-audit.test.ts functions/post/__tests__/post.test.ts`
Expected: FAIL because archive indexing is currently skipped.

- [ ] **Step 3: Implement section-optional indexing**

Remove the blanket archive skip. Make `sectionId` optional for archive index documents while retaining required community access and audit checks. Include normalized topics in searchable text and metadata. Ensure delete compensation applies to both native and migrated archive posts.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run Step 2.
Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add cloud/lib/post-rag-indexing.ts cloud/lib/post-rag.ts cloud/lib/content-audit.ts cloud/functions/post/index.ts cloud/lib/__tests__ cloud/functions/post/__tests__/post.test.ts
git commit -m "feat(search): index section-free archive posts"
```

### Task 5: Mini-program API and archive feed state

**Files:**
- Modify: `miniprogram/src/api/cloud.ts`
- Modify: `miniprogram/src/api/__tests__/cloud.test.ts`
- Create: `miniprogram/src/utils/archive-feed.ts`
- Create: `miniprogram/src/utils/__tests__/archive-feed.test.ts`

- [ ] **Step 1: Write failing API and column stability tests**

Cover `listArchiveTabs`, cursor `listArchive`, and a pure function:

```ts
appendArchivePage(columns, posts) // append to shorter measured/logical column without reshuffling existing cards
```

Also cover deterministic legacy text-cover fallback and duplicate post suppression across pages.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- --run src/api/__tests__/cloud.test.ts src/utils/__tests__/archive-feed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement typed API and feed helpers**

Export `ArchiveTab`, `ArchiveFeedCard`, `ArchiveFeedPage`, `normalizeArchiveCard`, and stable column append helpers. Keep UI-independent logic outside the large home page.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2.
Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add miniprogram/src/api/cloud.ts miniprogram/src/api/__tests__/cloud.test.ts miniprogram/src/utils/archive-feed.ts miniprogram/src/utils/__tests__/archive-feed.test.ts
git commit -m "feat(mp): add archive feed client state"
```

### Task 6: User-visible home tabs and unified waterfall

**Files:**
- Create: `miniprogram/src/components/ArchiveWaterfall.vue`
- Create: `miniprogram/src/components/ArchiveTopicTabs.vue`
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify/Create: relevant Vitest and static UI tests under `miniprogram/src/` and `scripts/`

- [ ] **Step 1: Write failing rendering/static tests**

Assert the home no longer renders evergreen section tabs or template-selected archive groups. Assert it renders `全部`, up to seven topics, two waterfall columns, loading skeletons, retry, empty publish CTA, and the lightweight realtime strip independently.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd --workspace miniprogram run test:unit -- --run` plus the exact new static test script.
Expected: the new selectors/components are missing.

- [ ] **Step 3: Implement topic tabs and waterfall components**

`ArchiveTopicTabs` emits a normalized key and never accepts section IDs. `ArchiveWaterfall` accepts stable columns, emits post/publish/retry/load-more events, uses the first image for image-text cards and `TextNoteCover` for text cards, and renders legacy fallback covers deterministically.

- [ ] **Step 4: Replace home evergreen group rendering**

Keep masthead, search, realtime items, refresh semantics, and tabbar. Remove user-visible evergreen section navigation and template-specific feed branches. Load tabs + `全部`, reset on community/topic changes, and append cursor pages without reshuffling cards.

- [ ] **Step 5: Run focused tests, type-check, and build**

Run:

```powershell
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add miniprogram/src/components/ArchiveWaterfall.vue miniprogram/src/components/ArchiveTopicTabs.vue miniprogram/src/pages/index/index.vue miniprogram/src scripts
git commit -m "feat(mp): show topic-driven archive waterfall"
```

### Task 7: Xiaohongshu-style publish routing and archive editors

**Files:**
- Modify: `miniprogram/src/components/AppTabBar.vue`
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/pages/detail/index.vue`
- Modify/Create: focused tests and static scripts

- [ ] **Step 1: Write failing route and UI tests**

Assert the `+` sheet has exactly `发图文`, `写文字`, and `发起协作`; no evergreen section options appear. Image/text routes enter section-free editor modes. Collaboration opens only active realtime sections. Native archive submit calls `createArchive`; legacy detail still loads its section renderer.

- [ ] **Step 2: Run tests and verify RED**

Run focused mini-program tests and `npm.cmd run test:mp:publish-ui-static`.
Expected: FAIL because the sheet still maps publishable sections.

- [ ] **Step 3: Implement the three-entry sheet**

Use a white bottom panel, light-gray rounded icon backgrounds, black line icons, short labels, and red only for key action state. Route image/text via an explicit `archiveFormat` intent; route collaboration via a realtime-only section picker.

- [ ] **Step 4: Adapt existing image-note/text-note editors**

Reuse `WidgetEditor`, `TopicPicker`, `TextNoteCover`, draft handling, image upload, membership guards, and submit feedback. Do not duplicate editor implementations. Native archive payloads contain `area`, `format`, `topics`, `content`, and no `sectionId`.

- [ ] **Step 5: Preserve legacy/native detail routing**

Route `origin === 'legacy_section'` through the existing section-aware renderer and native archive posts through image/text detail renderers.

- [ ] **Step 6: Verify full mini-program suite and commit**

Run the three commands from Task 6 Step 5 and publish UI static tests.
Expected: pass.

```powershell
git add miniprogram/src/components/AppTabBar.vue miniprogram/src/pages/create/index.vue miniprogram/src/pages/detail/index.vue miniprogram/src scripts
git commit -m "feat(mp): add section-free archive publishing"
```

### Task 8: Administrator archive-topic controls

**Files:**
- Modify: `cloud/functions/admin/index.ts`
- Modify: `cloud/functions/admin/__tests__/admin.test.ts`
- Modify: `admin-web/src/api/cloud.ts`
- Modify: `admin-web/src/router/index.ts`
- Modify: `admin-web/src/views/Layout.vue`
- Create: `admin-web/src/views/CommunityAdmin/ArchiveTopics.vue`
- Create/Modify: focused admin tests/static scripts

- [ ] **Step 1: Write failing admin API tests**

Cover list, add, rename, enable/hide, reorder, and delete-admin-origin behavior. Require community-admin scope. Assert realtime sections are never returned as topic candidates and removing `admin` does not delete legacy/organic origins.

- [ ] **Step 2: Run focused Cloud tests and verify RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runInBand functions/admin/__tests__/admin.test.ts`
Expected: FAIL on missing actions.

- [ ] **Step 3: Implement scoped admin actions**

Add `listArchiveTopics` and `saveArchiveTopicConfig` with server-side normalization, max lengths/counts, deterministic IDs, and audit fields.

- [ ] **Step 4: Write failing Admin Web tests/static checks**

Require a community route `/archive-topics/:communityId`, navigation entry, grouped legacy/manual rows, source badges, enable switch, order control, add/rename, and delete confirmation.

- [ ] **Step 5: Implement the Admin Web page**

Use existing Element Plus layout and cloud API patterns. Hide means `enabled=false`; deleting a manual topic removes only its admin origin.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm.cmd --workspace cloud run test:unit -- --runInBand functions/admin/__tests__/admin.test.ts
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
npm.cmd run test:admin:api
npm.cmd run test:admin:ui
```

Expected: pass without production mutation.

```powershell
git add cloud/functions/admin admin-web scripts
git commit -m "feat(admin): manage archive topics"
```

### Task 9: Full verification, closed-loop evidence boundary, and delivery

**Files:**
- Modify only files required by failures found during verification

- [ ] **Step 1: Run repository verification**

```powershell
npm.cmd --workspace cloud run test:unit
npm.cmd --workspace cloud run build
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:mp-weixin
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
node --test scripts/lib/archive-migration.test.mjs scripts/lib/ensure-indexes.test.mjs scripts/lib/release-plan.test.mjs
git diff --check
```

Expected: all pass; no whitespace errors.

- [ ] **Step 2: Assess real fixture eligibility**

Run `npm.cmd run validation:lease:status`. Only if the lease is available and credentials/environment are explicitly safe, create an isolated fixture community and exercise migration, archive publish/list/topic/search, realtime collaboration, and cleanup. Do not deploy or mutate production from this feature worktree.

- [ ] **Step 3: Request independent code review**

Review the full `origin/main...HEAD` diff for data loss, index/query mismatches, topic lifecycle drift, RAG regressions, legacy detail breakage, and frontend routing errors. Fix all Critical/Important findings with tests.

- [ ] **Step 4: Commit any review fixes and verify clean state**

Confirm author identity, `cwd`, branch, HEAD, and clean status.

- [ ] **Step 5: Push, create a ready PR, and monitor**

Push `codex/archive-user-visible`, create a non-draft PR documenting tests, migration/index actions, deployment targets, environment variables, acceptance, and known risks. Arm Merge Queue only after exact-HEAD required checks and reviews are clean. Monitor through `MERGED` or `CLOSED`. Do not deploy or publish.
