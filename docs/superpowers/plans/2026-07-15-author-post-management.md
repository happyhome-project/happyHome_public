# Author Post Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Xiaohongshu-style author edit/delete controls and a real two-column “我发布的” experience.

**Architecture:** Extend the authenticated post cloud function with an identity-scoped `listMine` query and archive-aware update handling. Reuse the existing create page as the single editor, then add a focused profile-post card adapter and page so visual presentation stays separate from data access.

**Tech Stack:** Vue 3, uni-app, TypeScript, CloudBase functions, Jest/Vitest, Wot Design Uni icons.

---

### Task 1: Define backend contracts with failing tests

**Files:**
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: `miniprogram/src/api/cloud.ts`

- [ ] Add a Jest test that calls `handleListMine({ skip: 0, limit: 20 }, 'author-1')` with active, deleted, and foreign-author posts and expects only the caller's non-deleted posts in descending `createdAt` order.
- [ ] Add a Jest test that expects `handleListMine` to reject an empty identity with `Missing OPENID`.
- [ ] Run `npm.cmd --prefix cloud test -- --runInBand functions/post/__tests__/post.test.ts` and confirm the new export/action is missing.
- [ ] Implement `handleListMine`, route `action === 'listMine'`, enrich community/section names, return `{ posts, total, skip, limit, hasMore }`, and expose `postApi.listMine` without accepting an author ID.
- [ ] Run the focused cloud test and confirm it passes.

### Task 2: Define edit mode and author sheet with failing UI contracts

**Files:**
- Create: `miniprogram/src/utils/__tests__/author-post-management.test.ts`
- Modify: `miniprogram/src/pages/detail/index.vue`
- Modify: `miniprogram/src/pages/create/index.vue`

- [ ] Add static assertions for `data-testid="post-settings-trigger"`, `data-testid="post-settings-sheet"`, horizontal `post-settings-actions`, Wot icons `edit-outline` and `delete-thin`, and edit navigation containing `editPostId`.
- [ ] Add static assertions that create page reads `editPostId`, calls `postApi.get`, pre-fills `formData`, displays `保存`, and calls `postApi.update`.
- [ ] Run `npm.cmd --prefix miniprogram test -- --run miniprogram/src/utils/__tests__/author-post-management.test.ts` and confirm the missing contracts fail.
- [ ] Replace the old delete row with the author-only trigger and rounded bottom sheet; keep the existing confirmation lock as the only delete executor.
- [ ] Add create-page edit loading, ownership-safe post retrieval, ordinary/archive contract normalization, prefill, and update submission.
- [ ] Re-run the focused miniprogram test and confirm it passes.

### Task 3: Make archive post updates preserve their contract

**Files:**
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: `miniprogram/src/api/cloud.ts`

- [ ] Add a failing test for updating an owned `area: 'archive', format: 'image_text'` post with `content`, `topics`, and `presentation` without resolving a physical section.
- [ ] Extend `post.update` parameters to accept archive topics/presentation; use `buildArchiveContentSection` for archive validation, normalize topics, and synchronize archive topic links after accepted updates.
- [ ] Run the focused cloud test and confirm ordinary ownership/audit tests and the new archive case pass.

### Task 4: Build the real “我发布的” page

**Files:**
- Create: `miniprogram/src/pages/my-posts/index.vue`
- Create: `miniprogram/src/utils/my-posts.ts`
- Create: `miniprogram/src/utils/__tests__/my-posts.test.ts`
- Modify: `miniprogram/src/pages/profile/index.vue`
- Modify: `miniprogram/src/pages.json`

- [ ] Write failing utility tests that map image-note, native archive image-text, text-note, and generic posts into cover/title/metadata card models.
- [ ] Implement the focused `my-posts.ts` adapter using existing image-note and text-note helpers.
- [ ] Add the new page with two balanced columns, first-image covers, `TextNoteCover` fallback, loading/empty/error states, refresh, pagination, and detail navigation.
- [ ] Route only the `posts` profile tool to `/pages/my-posts/index`; preserve existing placeholder behavior for unrelated tools.
- [ ] Run the focused utility/static tests and confirm the profile navigation and two-column contract pass.

### Task 5: Verify and deliver

**Files:**
- Modify if required: `scripts/test-image-note-static.mjs`

- [ ] Run focused cloud and miniprogram tests, `npm.cmd run test:mp:image-note-static`, `npm.cmd run test:mp:profile-critical-path`, and `npm.cmd run test:h5:web`.
- [ ] Start this worktree's H5 server and verify at 390 × 844: profile → 我发布的 → detail → author settings sheet → edit prefill/save; inspect console and capture screenshots.
- [ ] Confirm temporary fixture cleanup, validation lease absence, clean git diff, branch, HEAD, and author identity.
- [ ] Commit with `AngryBird <48046333+angrybirddd@users.noreply.github.com>`, push `codex/image-note-author-tools`, create a PR with test evidence, arm Merge Queue, and monitor exact HEAD until `MERGED` or `CLOSED`.

