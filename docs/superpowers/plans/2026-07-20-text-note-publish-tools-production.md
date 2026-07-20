# Text Note Publish Tools Production Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-20 production implementation sequence and does not override later repository state.
> **Current authority:** Use the [documentation authority map](../../README.md), current production code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move text-note topics to the cover step and add optional location using the existing image-note tool UI and data semantics.

**Architecture:** Extend the normalized locked `text_note` widget contract from title/body to title/body/topic/location so old and new sections resolve identically without a database migration. Render the optional tools only on the second step using `WidgetEditor`'s existing `image-note-tool` variant; keep post submission and detail rendering on the generic widget pipeline.

**Tech Stack:** TypeScript, Vue 3/uni-app, shared cloud contracts, Vitest, Node static tests.

## Global Constraints

- First step contains only required title and body.
- Second step reuses image-note topic and location controls.
- Topic and location are optional and do not appear on waterfall cards.
- No deployment, cloud mutation, or production upload from this feature worktree.

---

### Task 1: Extend the normalized text-note contract

**Files:**
- Modify: `cloud/shared/__tests__/text-note-widgets.test.ts`
- Modify: `cloud/shared/text-note-widgets.ts`
- Modify: `cloud/functions/admin/__tests__/admin.test.ts`
- Modify: `admin-web/src/views/CommunityAdmin/WidgetEditor.vue`
- Modify: `admin-web/src/views/CommunityAdmin/SectionList.vue`
- Modify: `scripts/test-admin-text-note-static.mjs`

**Interfaces:**
- Produces: locked optional widgets `text_topics` and `text_location` after `text_title` and `text_body`.

- [x] Update tests first to require the four-widget contract and revised admin explanation.
- [x] Run focused tests and observe failures caused by the missing optional widgets.
- [x] Add the two locked optional widgets and align admin locked IDs/copy.
- [x] Run focused contract and admin tests.

### Task 2: Move tools to the second publish step

**Files:**
- Modify: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`
- Modify: `miniprogram/src/pages/create/index.vue`

**Interfaces:**
- Consumes: `textNoteTopicWidget`, new `textNoteLocationWidget`, existing `WidgetEditor variant="image-note-tool"`.
- Produces: `text-note-publish-tools` on cover step only.

- [x] Add a static UI test proving compose excludes tools and cover renders both in topic/location order.
- [x] Run the test and observe failure.
- [x] Move topic and add location on the cover step, including native archive text widgets.
- [x] Run focused UI tests and type/build validation.

### Task 3: Verify and prepare PR

**Files:**
- Modify: this plan checkboxes only.

- [x] Run focused tests, complete cloud/admin/miniprogram/docs lanes, and `git diff --check`.
- [x] Review the diff for scope and backward compatibility.
- [ ] Commit, push, open a PR, monitor exact-HEAD CI/review, arm Merge Queue, and continue to terminal state.
