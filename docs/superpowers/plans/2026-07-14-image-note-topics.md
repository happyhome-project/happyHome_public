# Image Note Topics Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-14 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current repository rules, checked-in code, and tests. The approved image-note topics design is retained beside this plan for delivery traceability.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the reusable `#话题` widget and the community-available `图文_new` image-note template with Xiaohongshu-style publishing, feed, and detail surfaces.

**Architecture:** Keep topics inside the existing widget-driven `Post.content` map and add pure shared normalizers for topic values and image-note locked widgets. Route `displayTemplate: image_note` through template-specific mini-program presentation components while reusing existing upload, location, cloud URL, post, audit, like, and comment paths.

**Tech Stack:** TypeScript, Vue 3, uni-app, SCSS, Element Plus, CloudBase functions, Jest, Vitest, Node static checks, H5, mp-weixin.

---

### Task 1: Lock shared topic and image-note contracts

**Files:**
- Create: `cloud/shared/topics.ts`
- Create: `cloud/shared/image-note-widgets.ts`
- Create: `cloud/shared/__tests__/image-note-widgets.test.ts`
- Modify: `cloud/shared/types.ts`
- Modify: `cloud/shared/guide-note-widgets.ts`
- Test: `cloud/lib/__tests__/post-validate.test.ts`

- [ ] **Step 1: Write failing shared-contract tests**

Cover `normalizeTopics([' ##周末遛娃 ', '周末遛娃', ' 公园野餐 ']) === ['周末遛娃', '公园野餐']`, non-array rejection, 21-character rejection, six-topic rejection, `image_note` display-template normalization, the exact five locked widgets, and custom-widget ordering after the locked set.

- [ ] **Step 2: Run the focused tests and confirm contract failures**

Run:

```powershell
npm.cmd --workspace cloud test -- --runInBand shared/__tests__/image-note-widgets.test.ts lib/__tests__/post-validate.test.ts
```

Expected: FAIL because `image_note`, `topic`, and their normalizers do not exist.

- [ ] **Step 3: Add the public unions and pure normalizers**

Extend the unions exactly as follows:

```ts
export type SectionDisplayTemplate = 'default' | 'guide_note' | 'image_note'
export type WidgetType =
  | 'short_text'
  // existing values
  | 'topic'
```

Implement `normalizeTopics(value: unknown): string[]` in `cloud/shared/topics.ts`. It must require an array, normalize each string with `NFKC`, trim, remove all leading `#` plus following whitespace, reject values over 20 Unicode characters, deduplicate by normalized lowercase comparison while preserving the first display form, and reject more than five unique topics.

Implement `IMAGE_NOTE_LOCKED_WIDGETS` in the approved order and export the same helper family used by guide notes: `buildDefaultImageNoteWidgets`, `getImageNoteLockedWidget`, `isImageNoteSection`, `normalizeImageNoteWidgets`, and `normalizeImageNoteSection`.

Update `normalizeSectionDisplayTemplate` so only `guide_note` and `image_note` survive; all other values become `default`.

- [ ] **Step 4: Canonicalize and validate topic content at the cloud boundary**

In `cloud/lib/post-validate.ts`, transform allowed topic values during `sanitizeContent`:

```ts
const normalizedValue = widget?.type === 'topic' ? normalizeTopics(value) : value
if (widget?.type === 'topic' && normalizedValue.length === 0) return null
return [key, normalizedValue]
```

Keep malformed topic values as hard errors, not silent drops. Add a `validateContentValues` topic branch that requires the canonical string-array result. The same shared path must cover member create/edit and admin create/edit.

- [ ] **Step 5: Run shared/cloud tests and commit**

Run the focused command from Step 2 and expect PASS. Then commit:

```powershell
git add cloud/shared cloud/lib/post-validate.ts cloud/lib/__tests__/post-validate.test.ts
git commit -m "feat: add image note and topic contracts"
```

### Task 2: Add template lifecycle and admin configuration

**Files:**
- Modify: `cloud/functions/admin/index.ts`
- Modify: `cloud/functions/admin/__tests__/admin.test.ts`
- Modify: `admin-web/src/api/cloud.ts`
- Modify: `admin-web/src/views/CommunityAdmin/SectionList.vue`
- Modify: `admin-web/src/views/CommunityAdmin/WidgetEditor.vue`
- Modify: `admin-web/src/utils/postAdminForm.ts`
- Create: `admin-web/src/components/TopicAdminEditor.vue`
- Modify: `admin-web/src/views/CommunityAdmin/PostCreateAdmin.vue`
- Modify: `admin-web/src/views/CommunityAdmin/PostEditAdmin.vue`

- [ ] **Step 1: Write failing admin tests**

Add tests proving that `section.create` with `displayTemplate: 'image_note'` stores the five locked widgets, `section.list/get` normalizes legacy image-note shapes, locked widgets cannot be removed or changed by `section.updateWidgets`, and `topic` is accepted by the admin widget allowlist.

- [ ] **Step 2: Run the focused admin test and confirm failure**

```powershell
npm.cmd --workspace cloud test -- --runInBand functions/admin/__tests__/admin.test.ts
```

Expected: FAIL on missing image-note template support.

- [ ] **Step 3: Implement cloud template creation and locking**

Make `normalizeSection` apply both guide and image-note normalizers. Replace guide-only lock helpers with template-neutral helpers that select the relevant locked set from `section.displayTemplate`. For `section.create`, choose widgets with this explicit branch:

```ts
const widgets = displayTemplate === 'guide_note'
  ? buildDefaultGuideNoteWidgets()
  : displayTemplate === 'image_note'
    ? buildDefaultImageNoteWidgets()
    : []
```

Add `topic` to the admin-editable widget types. Preserve the existing structural-change confirmation and RAG/search reindex behavior.

- [ ] **Step 4: Expose `图文_new` and reusable topics in admin-web**

Extend all local/API template unions to include `image_note`. Add the radio option `图文_new` with help text that lists images, theme, body, topics, and optional location. Normalize API values without name-based fallbacks.

Add `话题` to both widget-type selectors. `TopicAdminEditor.vue` uses Element Plus tags plus an input, calls the shared topic normalizer before emitting, displays the five-topic limit, and allows chip removal. Initialize `topic` values as `[]` in `hydrateAdminPostFormData`, validate them in `validateAdminPostForm`, and render the editor in both admin create and edit pages.

- [ ] **Step 5: Verify admin paths and commit**

Run:

```powershell
npm.cmd --workspace cloud test -- --runInBand functions/admin/__tests__/admin.test.ts
npm.cmd --workspace admin-web run type-check
npm.cmd run test:admin:post-create-static
```

Expected: all PASS. Commit:

```powershell
git add cloud/functions/admin admin-web
git commit -m "feat: expose image note template in admin"
```

### Task 3: Build the member topic control and option-A publishing layout

**Files:**
- Create: `miniprogram/src/components/widgets/TopicPicker.vue`
- Modify: `miniprogram/src/components/widgets/WidgetEditor.vue`
- Modify: `miniprogram/src/utils/widget-form.ts`
- Modify: `miniprogram/src/pages/create/index.vue`
- Create: `miniprogram/src/utils/__tests__/image-note-create.test.ts`
- Modify: `scripts/test-create-publish-ui-static.mjs`

- [ ] **Step 1: Write failing publishing-layout tests**

Assert that `image_note` produces one main block containing images/title/body and one tool row containing topics/location, never creates a route-stats block, renders `# 话题` and `设置地点`, and prevents a sixth topic.

- [ ] **Step 2: Run tests and confirm the missing image-note UI**

```powershell
npm.cmd --workspace miniprogram test -- --run src/utils/__tests__/image-note-create.test.ts
npm.cmd run test:mp:publish-ui-static
```

Expected: FAIL because no topic editor or image-note block exists.

- [ ] **Step 3: Implement `TopicPicker.vue`**

The component accepts `modelValue: string[]` and emits `update:modelValue`. Its collapsed state shows selected `#话题` chips and a `# 话题` pill. A bottom `uni-popup` contains the input, add action, selected chips, removal controls, a `0/5` count, and an inline limit message. Enter/confirm and the add button both call the shared normalizer; invalid length and overflow produce a non-destructive toast.

- [ ] **Step 4: Add image-note variants to `WidgetEditor` and the create page**

Add the `topic` branch and an `image-note-tool` variant. In this variant, topics and location render as the compact approved pills; selected location shows its name and a clear affordance while reusing `wx.chooseLocation`.

In `create/index.vue`, derive `isImageNoteCreateMode` only from `displayTemplate === 'image_note'`. Build these blocks in order:

```ts
[
  { type: 'imageNoteMain', imageWidget, titleWidget, bodyWidget },
  { type: 'imageNoteTools', topicWidget, locationWidget },
  ...customWidgets,
]
```

Use the selected white canvas, black text, restrained separators, and red active/publish accent only for this template. Keep existing draft, upload, audit, submit lock, and navigation behavior.

- [ ] **Step 5: Verify H5/mp compilation and commit**

```powershell
npm.cmd --workspace miniprogram test -- --run src/utils/__tests__/image-note-create.test.ts
npm.cmd run test:mp:publish-ui-static
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: all PASS. Commit:

```powershell
git add miniprogram scripts/test-create-publish-ui-static.mjs
git commit -m "feat: add image note publishing controls"
```

### Task 4: Add image-note card and detail view models

**Files:**
- Create: `miniprogram/src/utils/image-note.ts`
- Create: `miniprogram/src/utils/__tests__/image-note.test.ts`
- Create: `miniprogram/src/components/ImageNoteDetailView.vue`
- Modify: `miniprogram/src/pages/detail/index.vue`

- [ ] **Step 1: Write failing view-model tests**

Build fixtures with the five locked widgets and assert extraction of cover images, title, rich-note body, normalized topics, optional location, author, like count, and created time. Assert missing optional values do not create empty UI rows.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm.cmd --workspace miniprogram test -- --run src/utils/__tests__/image-note.test.ts
```

Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement pure image-note extraction**

Export `getImageNoteCard(post, section)` and `buildImageNoteDetail(post, section)`. Prefer fixed widget IDs and fall back to field keys only for compatible legacy image-note data. Do not use section-name inference. Return a display model rather than exposing raw widget iteration to pages.

- [ ] **Step 4: Implement the dedicated detail component**

`ImageNoteDetailView.vue` renders an edge-to-edge swiper, author row, title, rich-note body, display-only `#话题` chips, and an optional `设置地点` row in that order. Emit a location-open event so the page can reuse existing `wx.openLocation`; keep like, comment, attendance, flags, and author metadata owned by the detail page.

Route only `displayTemplate === 'image_note'` to this component. Keep guide and default branches unchanged.

- [ ] **Step 5: Verify detail behavior and commit**

```powershell
npm.cmd --workspace miniprogram test -- --run src/utils/__tests__/image-note.test.ts
npm.cmd run test:mp:detail-runtime-syntax
npm.cmd --workspace miniprogram run type-check
```

Expected: all PASS. Commit:

```powershell
git add miniprogram/src/utils/image-note.ts miniprogram/src/utils/__tests__/image-note.test.ts miniprogram/src/components/ImageNoteDetailView.vue miniprogram/src/pages/detail/index.vue
git commit -m "feat: render image note details"
```

### Task 5: Route image notes through home and section feeds

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/pages/section/index.vue`
- Modify: `miniprogram/src/utils/widget.ts`
- Create: `scripts/test-image-note-static.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write a failing feed contract test**

Assert `image_note` is recognized only by the explicit template value, both home and section pages call `getImageNoteCard`, cards include cover/title/author/like count, and route statistics/location text are absent from image-note cards.

- [ ] **Step 2: Run it and confirm failure**

```powershell
node scripts/test-image-note-static.mjs
```

Expected: FAIL because image-note feed routing is missing.

- [ ] **Step 3: Implement the two-column feed route**

Extend archive/section display-template unions with `image_note`. Share the existing two-column geometry and cloud-image resolution infrastructure, but render a distinct image-note card body containing title, author avatar/name, and like count. Preserve bounded natural image ratios and existing image-failure placeholders.

Do not add `图文_new` to guide name hints and do not change the default selected archive policy except that image-note sections remain selectable normally.

- [ ] **Step 4: Verify feeds and commit**

```powershell
npm.cmd run test:mp:image-note-static
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
```

Expected: all PASS. Commit:

```powershell
git add miniprogram/src/pages/index/index.vue miniprogram/src/pages/section/index.vue miniprogram/src/utils/widget.ts scripts/test-image-note-static.mjs package.json
git commit -m "feat: show image notes in two-column feeds"
```

### Task 6: Close the validation loop and prepare the PR

**Files:**
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `scripts/lib/mp-release-ui-policy.test.mjs`
- Modify: `docs/figma-mini-0626-inventory.md`
- Test: affected cloud/admin/mini-program suites

- [ ] **Step 1: Add release-evidence assertions**

Add an isolated image-note scenario that verifies exact template/widget IDs, option-A tool row, topic selection, optional selected location, two-column card, and detail ordering. Fixture creation must use `fixture-write` under the machine validation lease and cleanup must be mandatory.

- [ ] **Step 2: Run the complete proportional test set**

```powershell
npm.cmd run docs:check
npm.cmd --workspace cloud test -- --runInBand
npm.cmd --workspace cloud run build
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
npm.cmd --workspace miniprogram test -- --run
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
npm.cmd run test:mp:publish-ui-static
npm.cmd run test:mp:image-note-static
npm.cmd run test:mp:replay-policy
```

Expected: all PASS, with no tracked build output changes.

- [ ] **Step 3: Perform lease-protected real UI validation**

Acquire the validation lease, create `图文_new-<runId>` in the fixed test community, publish one image note through H5 with two topics and a real selected location, verify persisted `Post.content`, home/section card, and detail page, then delete the post and section. Repeat the critical publish/feed/detail path in isolated WeChat DevTools. Release the lease even on failure.

- [ ] **Step 4: Update evidence documentation and commit**

Document the verified template, topic, location, H5, and native paths without claiming deployment. Commit:

```powershell
git add scripts/test-mp-release-ui.mjs scripts/lib/mp-release-ui-policy.test.mjs docs/figma-mini-0626-inventory.md
git commit -m "test: qualify image note topic flow"
```

- [ ] **Step 5: Sync only if required, push, and open the PR**

Confirm clean cwd/branch/HEAD. If a real conflict or explicit dependency exists, run the project worktree sync command; otherwise do not chase main. Push `codex/image-note-topics`, create a ready PR with scope/tests/deployment/data/acceptance/risk sections, monitor exact-HEAD CI/reviews/comments, arm Merge Queue with `gh pr merge <N> --auto --merge` after merge-ready, and continue to terminal `MERGED` or `CLOSED`.
