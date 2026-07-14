# Text Note Production Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-14 production implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), the production design specification, current code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with TDD and review gates.

**Goal:** Deliver a secure, configurable `text_note` template from admin creation through mini-program publication, two-column display, and full-text detail.

**Architecture:** Extend the shared template and post contracts first, then consume those contracts in admin and mini-program layers. Keep content widgets, presentation metadata, and visual derivation separate so the cloud validates business invariants and clients only render deterministic views.

**Tech Stack:** TypeScript cloud functions, Vue 3/uni-app mini-program, Vue admin web, Vitest/Jest/Node static tests, existing HappyHome release gates.

---

### Task 1: Shared template, cloud validation, and persistence

**Files:**
- Modify: `cloud/shared/types.ts`
- Create: `cloud/shared/text-note-widgets.ts`
- Modify: `cloud/shared/guide-note-widgets.ts`
- Modify: `cloud/lib/post-validate.ts`
- Modify: `cloud/functions/post/index.ts`
- Test: `cloud/lib/__tests__/post-validate.test.ts`
- Test: `cloud/functions/post/__tests__/post.test.ts`

- [ ] Add failing tests for template normalization, locked required title/body widgets, image-free rich-note enforcement, six accepted themes, paper fallback, invalid explicit theme rejection, and persisted `presentation`.
- [ ] Add `text_note`, `TextNoteTheme`, `PostPresentation`, and optional `Post.presentation` to shared types.
- [ ] Implement fixed text-note widgets and a shared three-template normalizer while preserving guide normalization behavior.
- [ ] Enforce no images in `text_body` and normalize/validate presentation after loading the section.
- [ ] Persist presentation during member post creation without placing it in `content`.
- [ ] Run focused cloud tests and the full cloud test suite.

### Task 2: Admin section contract

**Files:**
- Modify: `cloud/functions/admin/index.ts`
- Modify: `cloud/functions/admin/__tests__/admin.test.ts`
- Modify: `admin-web/src/api/cloud.ts`
- Modify: `admin-web/src/views/CommunityAdmin/SectionList.vue`
- Modify: `admin-web/src/views/CommunityAdmin/WidgetEditor.vue`
- Test: relevant admin tests/static contract

- [ ] Add failing tests for creating a text-note section, exact locked widgets, immutable fixed fields, and safe template-update behavior.
- [ ] Add “纯文字笔记” to the evergreen section selector and preserve `text_note` during load/edit/submit.
- [ ] Create and protect text-note fixed widgets on the cloud authority path.
- [ ] Prevent unsafe template switching for populated sections and avoid silent downgrade to default.
- [ ] Run admin cloud tests, admin type-check, and focused UI/static tests.

### Task 3: Mini-program two-step authoring

**Files:**
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/api/cloud.ts` if a request type is introduced
- Create: `miniprogram/src/utils/text-note.ts`
- Create: `miniprogram/src/utils/__tests__/text-note.test.ts`
- Create: `miniprogram/src/components/TextNoteCover.vue`
- Create/modify: focused static contract test script and `package.json` script

- [ ] Add failing utility/static tests for title/body extraction, Unicode-safe 64-character truncation, size bands, theme fallback, and the two-step/no-image/no-AI create contract.
- [ ] Implement the reusable view model and six-theme 4:5 cover.
- [ ] Add `text_note` compose/cover state to the existing create page while leaving default and guide branches unchanged.
- [ ] Submit `presentation.textNoteTheme` only for text-note sections and preserve draft/theme when returning to edit.
- [ ] Run mini-program type-check, unit tests, and focused static tests.

### Task 4: Home, section, and detail display

**Files:**
- Modify: `miniprogram/src/pages/index/index.vue`
- Modify: `miniprogram/src/pages/section/index.vue`
- Modify: `miniprogram/src/pages/detail/index.vue` only if explicit routing is necessary
- Modify/create: focused mini-program tests/static contracts

- [ ] Add failing tests proving `text_note` uses a dedicated two-column cover path and never enters guide image extraction or placeholder logic.
- [ ] Reuse `TextNoteCover` for home and section cards with title, author, time, and likes.
- [ ] Keep detail on the complete default rich-note rendering path while making template routing explicit.
- [ ] Verify six themes, paper fallback, fixed ratio, and long-content overflow in H5/mobile rendering.
- [ ] Run mini-program type-check, unit tests, H5 build/smoke where available, and WeChat build.

### Task 5: Cross-layer verification

**Files:**
- Modify only if verification exposes defects.

- [ ] Run cloud, admin, mini-program, documentation, and static contract suites.
- [ ] Verify the real local H5/UI/API/data loop with isolated fixture data if the test environment and validation lease are available; clean fixtures afterward.
- [ ] Run an independent spec review and code-quality review.
- [ ] Commit with the required AngryBird identity and leave deployment/publish untouched.
