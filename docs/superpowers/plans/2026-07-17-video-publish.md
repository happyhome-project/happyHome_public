# Member Video Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class single-video archive post flow selected from the unified member publish entry, without changing audio or allowing mixed image/video posts.

**Architecture:** Extend the discriminated archive contract with `format: 'video'`, normalize one existing COS `VideoItem`, and project that format into the existing widget renderer. Keep media selection/upload in focused mini-program utilities and a video editor component so the already-large create page only coordinates format selection, draft state, and submission.

**Tech Stack:** TypeScript, Vue 3, uni-app, WeChat CloudBase storage, Jest, Vitest, Node static guards.

---

### Task 1: Extend the archive contract with a video discriminator

**Files:**
- Modify: `cloud/shared/archive-post.ts`
- Modify: `cloud/shared/types.ts`
- Test: `cloud/shared/__tests__/archive-post.test.ts`

- [ ] Write failing tests that expect `ARCHIVE_POST_FORMATS` to contain `video`, accept exactly one normalized COS video in `videos`, and reject missing/empty/multiple videos, external sources, unknown fields, and audio fields.
- [ ] Run `npm.cmd --workspace cloud test -- --runInBand shared/__tests__/archive-post.test.ts` and confirm failures are caused by the absent `video` contract.
- [ ] Add `ArchiveVideoContent`, extend `ArchivePostCreateInput`, and parse only `{ title, body?, videos, location? }` for `format: 'video'`; require a one-element array, trim identifiers, and preserve only supported COS fields.
- [ ] Run the focused archive test and confirm it passes.
- [ ] Commit the contract change.

### Task 2: Validate and persist member video posts

**Files:**
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/lib/post-validate.ts`
- Test: `cloud/lib/__tests__/post-content-contract.test.ts`

- [ ] Write failing handler tests for creating and updating an archive `video` post with one COS video and for rejecting external/admin-only video sources.
- [ ] Run the focused cloud tests and confirm the video cases fail at the missing archive section/validation boundary.
- [ ] Build the synthetic archive video section with a single `video_group` widget plus title/body/location metadata, and add a member-video validation mode that validates only the archive video widget without enabling admin-only media for ordinary section posts.
- [ ] Run the focused cloud tests and confirm they pass without changing existing admin-only section behavior.
- [ ] Commit the server create/update change.

### Task 3: Add member-scoped upload authorization and object verification

**Files:**
- Create: `cloud/lib/member-video-upload.ts`
- Test: `cloud/lib/__tests__/member-video-upload.test.ts`
- Modify: `cloud/lib/storage.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`

- [ ] Write failing tests for member-scoped video/cover path issuance, allowed extensions, the 200 MB cap, actual remote object metadata verification, wrong-member prefixes, and non-video content types.
- [ ] Run the focused cloud tests and confirm the member upload actions/helpers are missing.
- [ ] Add post-function member upload actions that derive an opaque member path segment from authenticated identity and return CloudBase upload metadata without exposing admin actions.
- [ ] Resolve a temporary URL and inspect the uploaded object response metadata before create/update; reject wrong prefix, unsupported extension/content type, or actual size above 200 MB.
- [ ] Run the focused tests and confirm ordinary section video/audio writes remain blocked.
- [ ] Commit the upload authorization change.

### Task 4: Add reusable member video selection and client upload rules

**Files:**
- Create: `miniprogram/src/utils/video-publish.ts`
- Test: `miniprogram/src/utils/__tests__/video-publish.test.ts`
- Modify: `miniprogram/src/api/storage.ts`

- [ ] Write failing unit tests for supported extensions, the 200 MB size limit, single-video normalization, cloud-path generation under `posts/member-videos/`, cover-path generation, and format-switch confirmation decisions.
- [ ] Run `npm.cmd --workspace miniprogram exec vitest run src/utils/__tests__/video-publish.test.ts --pool=forks --maxWorkers=1` and confirm the helper is missing.
- [ ] Implement pure constants and helpers for validation, upload path generation, `VideoItemCos` construction, and media-format switching.
- [ ] Add upload progress plumbing to the existing storage wrapper without changing existing callers.
- [ ] Run the focused unit test and existing storage tests.
- [ ] Commit the upload rules.

### Task 5: Build the member video editor and route the first media selection

**Files:**
- Create: `miniprogram/src/components/widgets/VideoPublishEditor.vue`
- Modify: `miniprogram/src/components/widgets/WidgetEditor.vue`
- Modify: `miniprogram/src/components/AppTabBar.vue`
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `scripts/test-create-publish-ui-static.mjs`
- Test: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`

- [ ] Add failing static/unit assertions for one media-oriented entry, `chooseMedia` image/video routing, a single-video editor, upload progress/retry, cover selection, and no audio affordance.
- [ ] Run the focused UI/static tests and confirm they fail on the current image-only entry.
- [ ] Change the publish sheet archive action to a unified media action that invokes the picker; pass the selected media intent into the create page and route images to `image_text` or one video to `video`.
- [ ] Render `VideoPublishEditor` only for the member archive video widget; keep other `video_group` widgets administrator-only.
- [ ] Upload the selected video/cover through CloudBase storage, construct one COS `VideoItem`, block submit while upload is incomplete, and confirm before destructive type changes.
- [ ] Extend draft serialization/restoration with `video` while preserving image/text drafts.
- [ ] Run the focused UI/static tests and mini-program type-check.
- [ ] Commit the publish UI change.

### Task 6: Submit video archive posts through the typed API

**Files:**
- Modify: `miniprogram/src/api/cloud.ts`
- Modify: `miniprogram/src/api/__tests__/cloud.test.ts`
- Modify: `miniprogram/src/pages/create/index.vue`
- Test: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`

- [ ] Write failing assertions that the API accepts `format: 'video'`, the create page maps the video editor field to one `content.videos` item, and audio/video admin-only stripping remains in place for non-archive sections.
- [ ] Run the focused API/UI tests and confirm the type/behavior failures.
- [ ] Extend the archive API union and submission mapping for video posts without widening ordinary member section content.
- [ ] Run the focused tests and type-check.
- [ ] Commit the typed submission change.

### Task 7: Project video posts into feed, author cards, and detail

**Files:**
- Modify: `miniprogram/src/utils/archive-feed.ts`
- Modify: `miniprogram/src/utils/author-post-feed.ts`
- Modify: `miniprogram/src/pages/detail/index.vue`
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/pages/section/index.vue`
- Test: `miniprogram/src/utils/__tests__/archive-feed.test.ts`
- Test: `miniprogram/src/utils/__tests__/author-post-feed.test.ts`
- Test: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`

- [ ] Write failing tests for a video card discriminator, cover/placeholder resolution, play affordance metadata, and a synthetic detail section with one `video_group` widget.
- [ ] Run the focused feed/detail tests and confirm video currently degrades to text.
- [ ] Extend archive card and author-card normalized types with video identity and cover behavior.
- [ ] Project archive video detail into the existing `DefaultDetailView`/`VideoPlayerCard` path.
- [ ] Preserve existing image and text behavior exactly.
- [ ] Run the focused feed/detail tests and mini-program type-check.
- [ ] Commit the display change.

### Task 8: Connect audit, file extraction, and search coverage

**Files:**
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/lib/extract-file-ids.ts`
- Modify: `cloud/lib/post-search.ts`
- Test: `cloud/lib/__tests__/content-audit.test.ts`
- Test: `cloud/lib/__tests__/post-search.test.ts`
- Test: `cloud/functions/post/__tests__/post.test.ts`

- [ ] Write failing tests proving archive video and cover become audit/file-cleanup targets and video title/hint become searchable.
- [ ] Run the focused cloud tests and confirm the archive projection is missing.
- [ ] Route the synthetic video archive widget through existing video audit, extraction, and search logic without changing RAG enablement or budgets.
- [ ] Run the focused cloud tests.
- [ ] Commit the audit/search integration.

### Task 9: Regression verification and release metadata

**Files:**
- Modify if required by repository policy: `release/changes/20260717-member-video-publish.json`
- Review: `docs/superpowers/specs/2026-07-17-video-publish-design.md`

- [ ] Run `git diff --check`.
- [ ] Run focused cloud tests for archive, post, validation, audit, extraction, and search.
- [ ] Run `npm.cmd --workspace cloud test -- --runInBand`.
- [ ] Run `npm.cmd --workspace miniprogram run test:unit`.
- [ ] Run `npm.cmd run test:mp:publish-ui-static`.
- [ ] Run `npm.cmd --workspace miniprogram run type-check`.
- [ ] Run `npm.cmd --workspace miniprogram run build:h5`.
- [ ] Run `npm.cmd --workspace miniprogram run build:mp-weixin`.
- [ ] If the shared validation lease is free and a safe fixture is available, execute the isolated UI/API/data loop and clean up the temporary post/files; otherwise record the exact untested boundary.
- [ ] Review `git diff`, confirm only video-publish scope changed, and commit any final release metadata or fixes.

### Task 10: PR lifecycle and worktree retirement

- [ ] Confirm and report cwd, branch, HEAD, clean status, and commits unique to `origin/main`.
- [ ] Push `codex/video-publish` and verify the GitHub PR exact HEAD equals the pushed SHA.
- [ ] Create a PR documenting scope, tests, no deployment, no environment/index/migration change, acceptance steps, and known UI-validation boundary.
- [ ] Monitor exact-HEAD checks, reviews, and comments; fix actionable failures in this worktree and push normally.
- [ ] When merge-ready, run `gh pr merge <N> --auto --merge` and follow merge-group CI until `MERGED` or `CLOSED`.
- [ ] After `MERGED`, record this worktree path, confirm it is clean and has no Git operation, then run `npm.cmd run worktree:retire -- X:\Users\86136\.codex\worktrees\7ce2\happyHome_public` from `C:\Project\Claude\happyHome_public` once canonical main is clean and synchronized.
