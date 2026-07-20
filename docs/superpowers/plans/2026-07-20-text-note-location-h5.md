# Text Note Location H5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewable, local-only location interaction to the existing two-step text-note H5.

**Architecture:** Extend the prototype draft/post model with a nullable normalized location. Render selection only on preview, persist it through `sessionStorage`, and render it only in detail after publishing.

**Tech Stack:** Vanilla HTML, CSS, JavaScript, Node test runner.

## Global Constraints

- Do not modify the production mini program or cloud data.
- Keep compose focused on title and body.
- Do not show location on the waterfall card or text cover.

---

### Task 1: Location contract and interaction

**Files:**
- Modify: `prototype/text-note-h5/contract.test.mjs`
- Modify: `prototype/text-note-h5/app.js`
- Modify: `prototype/text-note-h5/styles.css`

**Interfaces:**
- Consumes: existing `state.draft`, `renderPreview()`, `publishDraft()`.
- Produces: `normalizeLocation(value)`, `renderLocationTool()`, `renderLocationSheet()`, `renderDetailLocation(post)`.

- [x] Write contract tests asserting preview-only placement, select/replace/clear behavior, and detail-only publishing.
- [x] Run `node --test prototype/text-note-h5/contract.test.mjs` and observe the three new tests fail because location renderers do not exist.
- [x] Add nullable location state, preview tool, bottom sheet, selection events, persistence, and detail rendering.
- [x] Run `node --test prototype/text-note-h5/contract.test.mjs`; expect 8 passing tests.
- [x] Validate compose, preview, selection, publishing, and detail in the in-app browser; keep the deliverable tab on preview for review.
