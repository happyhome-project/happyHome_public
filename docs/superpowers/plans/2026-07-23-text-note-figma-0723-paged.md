# Text Note Figma 0723 Paged Flow Implementation Plan

> **Historical / point-in-time:** This file preserves the implementation plan used for the 2026-07-23 Figma 0723 delivery; do not execute it as current instructions.
> **Current authority:** Use the [documentation authority index](../../README.md), current code, tests, and repository PR rules.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Figma 0723 compose → title-cover → body-preview flow, deterministic title/body pagination, one-page swiper snapping, and detail-carousel edge safety.

**Architecture:** Keep persisted title/body/theme data unchanged. Derive a cover-only first page plus one or more body-only pages in `text-note.ts`; render both through `TextNoteCover`, and move pages with one reusable non-circular `TextNoteDeck` swiper. The create page controls which deck page is foregrounded for the cover and body stages. Existing full-bleed image swipers gain a real page-edge safe inset and drag-preview suppression.

**Tech Stack:** Vue 3, uni-app, TypeScript, SCSS, Vitest, Node static checks, Figma MCP exported PNG assets.

## Global Constraints

- Figma authority is file `oilrInTWyKxGmRqhlP5UPX`, node `22075:1461`; do not read layout values from the retired Figma file.
- Card geometry is `370 / 498`; body text is `16px / 24px` inside a `312px` text box with 15 safe lines.
- Every generated deck has one cover page and at least one body page.
- No production deployment, mini-program upload, environment/index mutation, database migration, Markdown UI, image entry, or AI writing entry.
- No DOM measurement dependency and no syntax forbidden by the critical mini-program runtime checks.

---

### Task 1: Lock the new page and pagination contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/text-note.test.ts`
- Modify: `miniprogram/src/utils/text-note.ts`

**Interfaces:**
- Consumes: raw title/body/theme.
- Produces: `createTextNoteDeck(input): TextNoteDeck`, whose `pages[0]` is cover-only and `pages.slice(1)` is source-complete body-only pages.

- [ ] **Step 1: Write failing tests**

Add assertions equivalent to:

```ts
const deck = createTextNoteDeck({ title: '标题', body: '短正文', theme: 'paper' })
expect(deck.pages).toHaveLength(2)
expect(deck.pages[0]).toMatchObject({ kind: 'cover', body: '', sourceBody: '' })
expect(deck.pages[1]).toMatchObject({ kind: 'body', title: '', body: '短正文', sourceBody: '短正文' })
expect(deck.pages.slice(1).map((page) => page.sourceBody).join('')).toBe(normalizeTextNoteBody('短正文'))
```

Add boundary cases for 15/16 visual lines, manual blank lines, continuous English, long URL and Emoji.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd exec -- vitest run src/utils/__tests__/text-note.test.ts --pool=forks --maxWorkers=1
```

Expected: old one-page short deck and cover-body assertions fail.

- [ ] **Step 3: Implement line-budget pagination**

Replace cover-capacity branching with:

```ts
const bodyPages = paginateTextNoteBody(body)
const basePages = [
  { kind: 'cover', kicker, title, body: '', sourceBody: '' },
  ...bodyPages.map((pageBody) => ({
    kind: 'body',
    kicker,
    title: '',
    body: pageBody,
    sourceBody: pageBody,
  })),
]
```

Calculate page fit from per-line visual units and a 15-line limit while preserving Unicode clusters and source order.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: all text-note tests pass.

### Task 2: Match the paired Figma title/body cards

**Files:**
- Add: `miniprogram/src/static/text-note-covers/0723/{paper,mint,slate,headline,quote,notice}.jpg`
- Modify: `miniprogram/src/components/TextNoteCover.vue`
- Modify: `scripts/test-text-note-static.mjs`

**Interfaces:**
- Consumes: one `TextNotePage` and theme.
- Produces: exact-ratio title-only or body-only visual card.

- [ ] **Step 1: Make static checks fail for the new Figma contract**

Require `/static/text-note-covers/0723/<theme>.jpg`, `aspect-ratio: 370 / 498`, cover-only/body-only branches, and removal of the translucent body surface.

- [ ] **Step 2: Run static test and verify RED**

```powershell
npm.cmd run test:mp:text-note-static
```

Expected: current SVG paths, `4 / 5`, and mixed cover/body markup fail.

- [ ] **Step 3: Commit exact Figma assets and implement the card**

Use the downloaded bytes from nodes `22082:1724`, `1731`, `1739`, `1746`, `1753`, `1761`. Title-page positions come from nodes `22083:2668`, `2672`, `2677`, `2681`, `2684`, `2687`. Body text uses card-relative `left: 28px`, `top: 49px`, `width: 312px`, `font-size: 16px`, `line-height: 24px`.

- [ ] **Step 4: Run static and utility tests**

Expected: both suites pass and no card contains both title and body.

### Task 3: Replace free scrolling with one-page swiper snapping

**Files:**
- Modify: `miniprogram/src/components/TextNoteDeck.vue`
- Modify: `scripts/test-text-note-static.mjs`
- Modify: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`

**Interfaces:**
- Consumes: `TextNoteDeck`, optional one-based `currentPage`.
- Produces: `page-change` with a one-based page number.

- [ ] **Step 1: Add failing structure assertions**

Require `<swiper>`, `<swiper-item>`, `:current`, `:duration="260"` and `@change`; forbid horizontal `scroll-view` and scroll-width page estimation.

- [ ] **Step 2: Verify RED**

Run the two static/focused test commands. Expected: current `scroll-view` implementation fails.

- [ ] **Step 3: Implement the swiper**

Use a non-circular swiper whose item is exactly one card:

```vue
<swiper :current="currentPage - 1" :duration="260" :circular="false" @change="handleChange">
  <swiper-item v-for="page in resolvedDeck.pages" :key="page.pageNumber">
    <TextNoteCover ... />
  </swiper-item>
</swiper>
```

Update page progress directly from `event.detail.current`; delete scroll-left math and next-page peek.

- [ ] **Step 4: Verify GREEN**

Expected: one-page snapping contract and existing component tests pass.

### Task 4: Implement the Figma three-stage publish flow

**Files:**
- Modify: `miniprogram/src/pages/create/index.vue`
- Modify: `miniprogram/src/utils/__tests__/archive-publish-ui-static.test.ts`
- Modify: `scripts/test-create-publish-ui-static.mjs`

**Interfaces:**
- State: `textNoteStep: 'compose' | 'cover' | 'body'`.
- Cover action: `openTextNoteBodyPreview()`.
- Body action: existing `handleSubmit()`.

- [ ] **Step 1: Write failing flow assertions**

Require all three state literals, cover “下一步”, body “发布/保存”, current page 1→2, and no `text-note-confirm-sheet`.

- [ ] **Step 2: Verify RED**

Run focused Vitest and publish static checks. Expected: the two-state flow and confirmation sheet fail.

- [ ] **Step 3: Implement the state transitions**

Compose generates the deck and opens page 1; cover-next sets step to body and current page to 2; body submit calls `handleSubmit`. Back goes body → cover → compose. Theme switching regenerates the deck and retains the semantic stage.

- [ ] **Step 4: Match Figma spacing**

Use `16px` page inset, `370px` visual width at a `402px` viewport, the `120px` theme row, `36px` tool row and fixed `96px` bottom action area.

- [ ] **Step 5: Verify GREEN**

Expected: flow/static tests pass without a confirmation overlay.

### Task 5: Align text-note detail and reduce swipe-back gesture competition

**Files:**
- Modify: `miniprogram/src/components/DefaultDetailView.vue`
- Modify: `miniprogram/src/components/ImageNoteDetailView.vue`
- Modify: `miniprogram/src/components/GuideRouteDetailView.vue`
- Modify: `miniprogram/src/pages/detail/index.vue`
- Create: `miniprogram/src/utils/__tests__/detail-carousel-safety-static.test.ts`

**Interfaces:**
- Text-note detail order: title → deck → author/date.
- Carousel safe zone: actual swiper hitbox has horizontal `var(--hh-page-x)` inset.

- [ ] **Step 1: Write failing static tests**

Assert that image and guide swiper containers have a real horizontal safe inset, touch handlers stop bubbling, image-note drag state suppresses preview taps, and text-note author renders after the deck.

- [ ] **Step 2: Verify RED**

Run the new test. Expected: current full-bleed image/guide carousels and author-before-card layout fail.

- [ ] **Step 3: Implement the minimum gesture fix**

Inset the real hero containers, not only their child images. Add `.stop` to swiper touch handlers. Port the existing `8px` drag-preview suppression from guide to image-note. Keep explicit back button and page-stack semantics unchanged.

- [ ] **Step 4: Align text-note detail**

Use a white text-note detail surface, hide its section pill/naked body, and render author/date after the deck.

- [ ] **Step 5: Verify GREEN**

Expected: focused tests and detail syntax check pass.

### Task 6: Verify, deliver, and close the PR lifecycle

**Files:**
- Review all changed files.

- [ ] **Step 1: Run focused and full verification**

```powershell
npm.cmd --prefix miniprogram run type-check
npm.cmd run test:mp:text-note-static
npm.cmd run test:mp:publish-ui-static
npm.cmd run test:mp:detail-runtime-syntax
npm.cmd --prefix miniprogram run test:unit
npm.cmd --prefix miniprogram run build:h5
npm.cmd --prefix miniprogram run build:mp-weixin
git diff --check
```

- [ ] **Step 2: Visual and interaction QA**

Inspect `402×917` and `390×844` H5 views. Verify title-only page 1, body-only page 2+, one-page snapping, topic/location, direct publish action, and text-note detail order. Record that native WeChat edge-back frequency requires iOS/Android real-device validation.

- [ ] **Step 3: Commit and push as AngryBird**

Confirm Git identity, clean status, exact cwd/branch/HEAD, then commit and push `codex/text-note-paged-swipe`.

- [ ] **Step 4: Create and own the PR to terminal state**

Create a ready PR with tests, Figma source, no-deploy declaration and real-device gesture risk. Confirm exact remote HEAD, monitor required checks/reviews, arm Merge Queue, and wait for `MERGED` or `CLOSED`.

- [ ] **Step 5: Retire the worktree after merge**

Fast-forward canonical main, confirm the feature worktree is clean and has no Git operation, run official `worktree:retire`, and verify the directory is removed.
