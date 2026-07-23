# Dynamic Text Note Production Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-23 implementation sequence.
> **Current authority:** Use the [documentation authority index](../../README.md), current code, tests, and repository PR rules.

**Goal:** Implement deterministic multi-page `4:5` text-note generation, preview confirmation, and paged detail rendering without changing the persisted post contract.

**Architecture:** Keep raw post content and the selected theme as the source of truth. Add a pure, runtime-safe layout engine that derives a deck from full plain text, render each page through the existing theme component, and reuse the deck in create preview and detail. Feed surfaces continue to render only the first cover.

**Tech stack:** Vue 3, uni-app, TypeScript, Vitest, Node static checks.

## Constraints

- No production deployment, mini-program upload, environment/index mutation, or database migration. A uniquely identifiable temporary post may be created only for closed-loop validation and must be deleted and verified in the same run.
- No image entry, Markdown controls, or AI writing affordance in text-note authoring.
- No DOM measurement dependency in the mini-program runtime.
- No `Array.from`, Unicode property escapes, or other syntax rejected by critical mini-program chunk checks.
- Existing topic/location behavior and historical `rich_note` posts remain compatible.

## Tasks

### 1. Specify and test the layout engine

- Extend `miniprogram/src/utils/__tests__/text-note.test.ts` with short/long deck, paragraph fidelity, salutation, theme capacity, Emoji, long URL and no-loss assertions.
- Add pure layout types and deterministic pagination to `miniprogram/src/utils/text-note.ts`.
- Run focused utility tests and critical-runtime checks.

### 2. Render fixed-ratio page decks

- Extend `TextNoteCover.vue` so one component can render a cover page or a fixed-ratio body page.
- Add `TextNoteDeck.vue` for horizontal paging, next-page affordance and page count.
- Replace the expanding detail document with the same deck.
- Add component/static assertions for fixed `4:5` pages and no duplicate naked body.

### 3. Implement the three-state publish flow

- Keep compose as title/body only.
- Add visible layout-generation state.
- Replace the single preview with the page deck; remove the duplicate page rail and redundant heading.
- Keep the six theme choices and existing topic/location tools.
- Change the preview action to “下一步” and add a final confirmation layer containing the real publish/save action.
- Add static and navigation tests for the state semantics.

### 4. Verify and deliver

- Run focused tests, full mini-program unit/static suites, type-check, H5 build and WeChat build.
- Verify the formal H5 flow at mobile viewport and inspect the built mini-program output.
- Review scope and compatibility, commit as AngryBird, push, create the PR, monitor exact-HEAD CI/review, arm Merge Queue, and continue to terminal state.
