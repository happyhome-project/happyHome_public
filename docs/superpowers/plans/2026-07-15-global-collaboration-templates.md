# Global Collaboration Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace community-scoped realtime sections with globally managed collaboration templates and section-free collaboration posts, initially preserving only `拼车出行` and `出游邀约`.

**Architecture:** Store template definitions once in `collaboration_templates`; collaboration posts keep `communityId` but use `area: 'collaboration'` and `collaborationTemplateId` instead of `sectionId`. A dedicated cloud function exposes active templates, the admin function owns super-admin CRUD, and existing post/home/detail flows resolve templates for validation and rendering. A guarded prepare/apply migration preserves posts belonging to the two retained templates, removes other realtime content, and proves archive data is untouched.

**Tech Stack:** TypeScript, wx-server-sdk/CloudBase, Vue 3 + uni-app, Vue 3 + Element Plus, Jest, Vitest, Node test runner.

---

## File structure

- Create `cloud/shared/collaboration-templates.ts`: canonical template definitions, normalization, stable-key resolution, and safe-change analysis.
- Modify `cloud/shared/types.ts`: global template and section-free collaboration-post types.
- Create `cloud/functions/collaboration-template/index.ts`: active list/get cloud-function entrypoint.
- Create `cloud/functions/collaboration-template/__tests__/collaboration-template.test.ts`: public read contract.
- Modify `cloud/functions/post/index.ts` and its tests: create/list/get/update/delete/attendance and activity-invite flows without sections.
- Modify `cloud/lib/home-snapshot.ts`, `cloud/functions/home-prefetch/index.ts`, and tests: return global templates and posts by template.
- Modify `cloud/functions/admin/index.ts` and tests: super-admin template CRUD plus collaboration-post filtering and scope enforcement.
- Modify `miniprogram/src/api/cloud.ts`, create/detail/home pages, widget utilities, and tests: global template picker and renderer.
- Create `admin-web/src/views/SuperAdmin/CollaborationTemplateList.vue`; modify router/layout/API and static tests.
- Create `scripts/migrate-global-collaboration.mjs` and `scripts/lib/global-collaboration-migration*.mjs`: idempotent prepare/apply migration.
- Modify `scripts/ensure-indexes.mjs`, `scripts/deploy.mjs`, package scripts, release metadata, and governance tests.

### Task 1: Shared global-template contract

**Files:**
- Create: `cloud/shared/collaboration-templates.ts`
- Create: `cloud/shared/__tests__/collaboration-templates.test.ts`
- Modify: `cloud/shared/types.ts`

- [ ] **Step 1: Write failing tests for the two canonical templates**

Assert that `buildInitialCollaborationTemplates()` returns exactly `carpool` and `activity_invite`; carpool orders an optional image-capable `note_blocks` control immediately after `carpool_location`; activity invite reuses the established stable widget IDs.

```ts
expect(templates.map((item) => item.systemKey)).toEqual(['carpool', 'activity_invite'])
expect(carpool.widgets.at(-1)).toMatchObject({
  widgetId: 'carpool_note', type: 'note_blocks', label: '补充说明', required: false,
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd --workspace cloud exec jest -- --config jest.config.js shared/__tests__/collaboration-templates.test.ts --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement canonical types and definitions**

Add `CollaborationTemplate`, extend `Post.area` with `collaboration`, and make `sectionId` optional. Implement stable definitions using `buildActivityInviteSectionWidgets()` and these carpool IDs:

```ts
carpool_origin
carpool_destination
carpool_departure_time
carpool_location
carpool_note
```

Add helpers to normalize a template, convert it to a section-shaped validation contract, resolve protected system keys, and classify unsafe widget mutations.

- [ ] **Step 4: Verify GREEN and run shared tests**

Run the focused test, then `npm.cmd --workspace cloud run test:unit`.

- [ ] **Step 5: Commit**

```powershell
git add cloud/shared/types.ts cloud/shared/collaboration-templates.ts cloud/shared/__tests__/collaboration-templates.test.ts
git commit -m "feat: define global collaboration templates"
```

### Task 2: Template read function and provisioning

**Files:**
- Create: `cloud/functions/collaboration-template/index.ts`
- Create: `cloud/functions/collaboration-template/__tests__/collaboration-template.test.ts`
- Modify: `cloud/__tests__/main-entry.test.ts`
- Modify: `scripts/ensure-indexes.mjs`
- Modify: `scripts/deploy.mjs`

- [ ] **Step 1: Write failing list/get tests**

Cover `listActive` ordering, disabled-template exclusion, `get` lookup, unknown actions, and normalization of stored widgets.

- [ ] **Step 2: Verify RED**

Run the focused Jest file and confirm module-not-found failure.

- [ ] **Step 3: Implement the cloud function**

Use `db.query('collaboration_templates', { status: 'active' }, { orderBy: ['order', 'asc'] })`; expose only `listActive` and `get`. Do not accept template writes here.

- [ ] **Step 4: Add release provisioning**

Add `collaboration_templates` to `REQUIRED_COLLECTIONS`, a unique `systemKey` index, a status/order index, and a posts index on `communityId + area + collaborationTemplateId + status + createdAt`. Add `collaboration-template` to `CLOUD_FUNCTIONS`.

- [ ] **Step 5: Verify focused tests, cloud build, and deploy-governance tests**

Run:

```powershell
npm.cmd --workspace cloud run test:unit
npm.cmd --workspace cloud run build
npm.cmd run test:deploy-output
```

- [ ] **Step 6: Commit**

Commit as `feat: expose global collaboration templates`.

### Task 3: Section-free collaboration posts

**Files:**
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/lib/post-validate.ts`

- [ ] **Step 1: Write failing create/list/get tests**

Test that `createCollaboration` loads an active global template, checks active membership, validates its widgets, writes `area: 'collaboration'` and no `sectionId`, and that `listCollaboration` is scoped by community/template. Test that optional `carpool_note` accepts text and `cloud://` image blocks.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd --workspace cloud exec jest -- --config jest.config.js functions/post/__tests__/post.test.ts --runInBand`

Expected: unknown action or missing handler.

- [ ] **Step 3: Implement a shared post-template resolver**

Resolve archive posts through the existing virtual archive section, collaboration posts through `collaboration_templates`, and only legacy posts through `sections`. Reuse `sanitizeContent`, `validateRequiredWidgets`, `validateContentValues`, attendance, audit, and member-only masking.

- [ ] **Step 4: Implement create/list routing**

Add `createCollaboration` and `listCollaboration`; do not alter `createArchive`. Set `collaborationSystemKey` from the stored template and preserve content-audit behavior.

- [ ] **Step 5: Extend get/update/delete/attendance**

Author ownership remains mandatory for mini-program update/delete. Resolve collaboration templates for rendering and attendance without reading `sections`. Preserve admin soft-delete and RAG/search cleanup behavior.

- [ ] **Step 6: Refactor activity-invite creation**

Replace `findActivityInviteSection/ensureActivityInviteSection/buildVirtualActivityInviteSection` with the global `activity_invite` template. Create section-free linked posts while preserving origin metadata, duplicate-in-progress protection, member-only contact, and attendance.

- [ ] **Step 7: Verify GREEN and cloud regression**

Run focused post tests and the full cloud unit suite.

- [ ] **Step 8: Commit**

Commit as `feat: add section-free collaboration posts`.

### Task 4: Home/bootstrap contract

**Files:**
- Modify: `cloud/lib/home-snapshot.ts`
- Modify: `cloud/lib/__tests__/home-snapshot.test.ts`
- Modify: `cloud/functions/home-prefetch/index.ts`
- Modify: `cloud/functions/home-prefetch/__tests__/home-prefetch.test.ts`
- Modify: `cloud/functions/post/index.ts`

- [ ] **Step 1: Add failing snapshot tests**

Assert that the current community receives active global collaboration templates plus `collaborationPostsByTemplate`, and that archive tabs/items remain byte-for-byte equivalent to the existing fixture.

- [ ] **Step 2: Verify RED**

Run the two focused Jest files.

- [ ] **Step 3: Implement the new response shape**

Query `posts` by `communityId + area: collaboration`; enrich author, visibility and attendance using the template map. Stop depending on realtime sections for the home strip. Keep legacy fields temporarily only where older clients require them.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat: bootstrap global collaboration feeds`.

### Task 5: Mini-program global collaboration picker and editor

**Files:**
- Modify: `miniprogram/src/api/cloud.ts`
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/pages/detail/index.vue`
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/store/community.ts`
- Modify: `miniprogram/src/utils/widget.ts`
- Modify/add: focused files under `miniprogram/src/**/__tests__/`

- [ ] **Step 1: Write failing API and static flow tests**

Assert `mode=collaboration` calls `collaboration-template.listActive`, does not filter `currentSections`, submits `post.createCollaboration`, renders the two global choices, and never requires a section ID. Add ownership tests showing ordinary members can edit/delete only their own collaboration posts.

- [ ] **Step 2: Verify RED with focused Vitest**

Run the new test files directly through Vitest.

- [ ] **Step 3: Implement client APIs and create flow**

Add `collaborationTemplateApi`; change collaboration mode to fetch templates and select a template-shaped form contract. Route submission to `createCollaboration`; preserve archive-format routing unchanged.

- [ ] **Step 4: Enable carpool note images**

The generic `note_blocks` path keeps `allowRichNoteImages=true`. Retain the existing activity-invite image exception unless the product requirement changes.

- [ ] **Step 5: Update home/detail rendering**

Use returned template definitions for title, list summary, attendance and content blocks. Keep author edit/delete actions based on `authorId`.

- [ ] **Step 6: Verify tests, type-check, and builds**

Run:

```powershell
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:mp-weixin
```

- [ ] **Step 7: Commit**

Commit as `feat: publish global collaboration posts`.

### Task 6: Super-admin global template management

**Files:**
- Modify: `cloud/functions/admin/index.ts`
- Modify: `cloud/functions/admin/__tests__/admin.test.ts`
- Modify: `cloud/__tests__/admin-scope.test.ts`
- Modify: `admin-web/src/api/cloud.ts`
- Modify: `admin-web/src/router/index.ts`
- Modify: `admin-web/src/views/Layout.vue`
- Create: `admin-web/src/views/SuperAdmin/CollaborationTemplateList.vue`
- Create: `admin-web/tests/collaboration-template-admin-contract.test.mjs`
- Modify: `admin-web/package.json`

- [ ] **Step 1: Write failing admin permission tests**

Assert every template write is super-admin-only; community admins cannot create/update/disable/delete templates; community admins can still edit/soft-delete collaboration posts in owned communities; super admins can do so across communities.

- [ ] **Step 2: Verify RED**

Run focused admin Jest tests.

- [ ] **Step 3: Implement CRUD and mutation safety**

Add actions to `SUPER_ADMIN_ONLY`. Enforce unique stable keys/names, protected keys, safe widget changes, no delete with posts, and disabled-template semantics.

- [ ] **Step 4: Write and verify failing admin-web contract test**

Assert the global menu is super-admin-only, the page is not nested under a community, and API actions match the backend.

- [ ] **Step 5: Implement the Web Admin page**

Reuse the existing widget editor where possible. Provide list/create/edit/enable-disable controls and impact errors. Remove realtime creation responsibility from per-community section management without reopening archive customization.

- [ ] **Step 6: Verify all admin checks**

Run admin tests, type-check, build, cloud admin tests, and `scripts/test-admin-ui.mjs` only in its static/local-safe mode; do not connect to shared cloud.

- [ ] **Step 7: Commit**

Commit as `feat: manage collaboration templates globally`.

### Task 7: Guarded data migration

**Files:**
- Create: `scripts/lib/global-collaboration-migration.mjs`
- Create: `scripts/lib/global-collaboration-migration.test.mjs`
- Create: `scripts/migrate-global-collaboration.mjs`
- Modify: `package.json`
- Add: `release/migrations/20260715-global-collaboration-v1.mjs`
- Add: `release/changes/20260715-global-collaboration.json`

- [ ] **Step 1: Write failing pure migration tests**

Cover classification of carpool/activity-invite/delete sections, semantic widget mapping, retained-post conversion, dependent-data deletion, shared-file reference protection, archive mutation rejection, manifest hash verification, rerun no-op, and failure before destructive steps.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/global-collaboration-migration.test.mjs`.

- [ ] **Step 3: Implement pure planner and prepare command**

Prepare reads production state but performs no mutation. It records exact IDs/counts/hashes and refuses to continue if the live MingShi carpool controls or archive exclusion assertions do not match.

- [ ] **Step 4: Implement apply command**

Apply requires the immutable manifest and matching environment/HEAD. Seed templates, migrate retained posts, delete only classified realtime content and unreferenced files, delete old realtime sections, and record completion. Every mutation is idempotent.

- [ ] **Step 5: Wire release metadata and governance**

Add the migration to the release component registry/plan as required by repository policy. The feature worktree only runs pure tests and dry-run fixture tests.

- [ ] **Step 6: Verify migration and governance tests**

Run pure migration tests, `npm.cmd run test:governance`, `npm.cmd run test:deploy-output`, and `git diff --check`.

- [ ] **Step 7: Commit**

Commit as `feat: migrate realtime sections to global collaboration`.

### Task 8: Final regression and PR evidence

**Files:**
- Verify: `cloud/functions/post/index.ts`, `cloud/functions/admin/index.ts`, `miniprogram/src/pages/create/index.vue`, `admin-web/src/views/SuperAdmin/CollaborationTemplateList.vue`, and `scripts/lib/global-collaboration-migration.mjs`.
- Verify: `docs/release-gate.md` and generated release metadata.

- [ ] **Step 1: Run full offline verification**

```powershell
npm.cmd --workspace cloud run test:unit
npm.cmd --workspace cloud run test:integration
npm.cmd --workspace cloud run build
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:mp-weixin
npm.cmd --workspace admin-web run test:unit
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
npm.cmd run test:governance
npm.cmd run test:deploy-output
npm.cmd run docs:check
git diff --check
```

- [ ] **Step 2: Perform scoped self-review**

Review archive zero-change behavior, role boundaries, no-section assumptions, destructive migration gating, storage reference safety, and deployment manifests.

- [ ] **Step 3: Commit only evidence-driven fixes**

Do not run production prepare/apply, cloud fixture writes, deploys, DevTools, or release commands from this worktree.

- [ ] **Step 4: Push and open PR**

The PR description must distinguish implemented/tested/committed/pushed/CI and explicitly state that production migration is not executed by the feature task.

- [ ] **Step 5: Follow PR to terminal state**

Track exact HEAD checks/reviews/comments, arm Merge Queue with `gh pr merge <N> --auto --merge`, and continue until `MERGED` or `CLOSED` per repository policy.
