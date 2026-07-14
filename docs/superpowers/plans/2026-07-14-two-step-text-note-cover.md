# Two-Step Text Note Cover Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-14 prototype iteration. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current text-note prototype code, its design specification, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the combined editor/theme screen with a focused writing step followed by a real-content cover-selection step containing six distinct HappyHome cover styles.

**Architecture:** Keep the existing hash-routed, sessionStorage-only vanilla prototype. Change `compose` to writing-only, reuse `preview` as the cover-selection/publish step, and extend the theme renderer so the same style contract drives the large preview, thumbnails, feed cards, and detail accent.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node-based source contract tests, Playwright CLI visual verification.

---

### Task 1: Add flow and theme contract tests

**Files:**
- Create: `prototype/text-note-h5/contract.test.mjs`

- [ ] Write a Node test that asserts six theme IDs exist; compose does not render the theme picker; preview renders the theme picker; preview uses the heading “选择文字封面”; and the notice style contains the label “通知公告”.
- [ ] Run `node --test prototype/text-note-h5/contract.test.mjs` and verify it fails because the current compose screen still renders themes and only three theme definitions exist.
- [ ] Keep this test as a fast regression contract for the prototype source.

### Task 2: Implement the focused writing step

**Files:**
- Modify: `prototype/text-note-h5/app.js`
- Modify: `prototype/text-note-h5/styles.css`

- [ ] Remove the theme section from `renderCompose()` while retaining title, body, character count, draft persistence, validation, and the “下一步” action.
- [ ] Give the editor more vertical space and add concise step context without introducing topics, images, AI, or cover controls.
- [ ] Run the contract test and verify the compose-flow assertion passes.

### Task 3: Implement six real-content cover styles

**Files:**
- Modify: `prototype/text-note-h5/app.js`
- Modify: `prototype/text-note-h5/styles.css`

- [ ] Extend the theme contract with `headline`, `quote`, and `notice` alongside `paper`, `mint`, and `slate`.
- [ ] Render one large 4:5 cover using the real title and first paragraph, with immediate switching from a horizontally scrollable six-style tray.
- [ ] Make the styles structurally distinct: centered large type, editorial quote, and a “通知公告” information label, while keeping HappyHome colors and typography.
- [ ] Ensure the same theme renderer appears in feed cards and uses the existing 64-character Unicode-safe cover logic.
- [ ] Run the contract test and verify all assertions pass.

### Task 4: Browser verification and delivery

**Files:**
- Modify if needed: `prototype/text-note-h5/app.js`
- Modify if needed: `prototype/text-note-h5/styles.css`

- [ ] In a 390×844 viewport, verify empty validation, writing, next-step navigation, all six style switches, return-with-content, publish insertion, feed card, and detail.
- [ ] Verify short copy, long copy, manual paragraph breaks, Emoji, continuous English, and long URLs do not overflow the fixed 4:5 cover.
- [ ] Verify at desktop width and confirm zero browser console errors.
- [ ] Run `git diff --check`, `node --check prototype/text-note-h5/app.js`, `node --test prototype/text-note-h5/contract.test.mjs`, and `npm.cmd run docs:check`.
- [ ] Commit the implementation on `codex/text-note-h5-design` and leave the local H5 server running for annotation.
