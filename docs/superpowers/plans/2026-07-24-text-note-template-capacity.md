# Text Note Template Capacity Implementation Plan

> **Historical / point-in-time:** This file preserves the implementation plan used for the 2026-07-24 text-note capacity calibration; do not execute it as current instructions.
> **Current authority:** Use the [documentation authority index](../../README.md), current code, tests, Figma, and repository PR rules.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single conservative text-note body box with six approved theme-specific safe areas and pagination budgets while preserving every source character.

**Architecture:** Add one immutable layout contract in `text-note.ts` and make both deterministic pagination and `TextNoteCover` consume it. Keep the persisted post contract unchanged; decks remain derived from title, full body, and theme. Use static template-capacity tests plus existing H5/mini-program builds for cross-surface verification.

**Tech Stack:** Vue 3, uni-app, TypeScript, SCSS, Vitest, Node test runner.

## Global Constraints

- Work only in `C:\Project\Claude\happyHome_public_text_note_template_h5` on `codex/text-note-template-h5`.
- Use the approved `prototype/text-note-capacity-h5/` and Figma file `oilrInTWyKxGmRqhlP5UPX`, node `22075:1461`.
- Keep the `370 / 498` card ratio and `16px / 24px` body typography.
- Do not modify persisted post fields, cloud APIs, Figma, deployment state, or unrelated publishing flows.
- Preserve normalized source text exactly across `TextNotePage.sourceBody`.
- Follow red-green-refactor for every production behavior change.

---

### Task 1: Theme-specific pagination contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/text-note.test.ts`
- Modify: `miniprogram/src/utils/text-note.ts`

**Interfaces:**
- Produces: `TextNoteBodyLayout`, `TEXT_NOTE_BODY_LAYOUTS`, and `getTextNoteBodyLayout(theme)`.
- Produces: `paginateTextNoteBody(value, { theme, unitsPerLine, maxLines, maxVisualUnits })`.
- Consumes: existing `TextNoteTheme`, `normalizeTextNoteTheme`, Unicode grapheme splitter, and source-complete `TextNotePage`.

- [ ] **Step 1: Write the failing six-layout contract test**

Add a test that expects these normalized contracts:

```ts
expect(Object.fromEntries(TEXT_NOTE_THEMES.map((theme) => {
  const layout = getTextNoteBodyLayout(theme)
  return [theme, {
    safeRect: layout.safeRect,
    unitsPerLine: layout.unitsPerLine,
    maxLines: layout.maxLines,
    referenceCapacity: layout.referenceCapacity,
    safeCapacity: layout.safeCapacity,
  }]
}))).toEqual({
  paper: { safeRect: { x: 32, y: 48, width: 306, height: 384 }, unitsPerLine: 19, maxLines: 16, referenceCapacity: 304, safeCapacity: 303 },
  mint: { safeRect: { x: 32, y: 52, width: 306, height: 384 }, unitsPerLine: 19, maxLines: 16, referenceCapacity: 304, safeCapacity: 303 },
  slate: { safeRect: { x: 36, y: 58, width: 298, height: 384 }, unitsPerLine: 18, maxLines: 16, referenceCapacity: 288, safeCapacity: 287 },
  headline: { safeRect: { x: 36, y: 94, width: 298, height: 360 }, unitsPerLine: 18, maxLines: 15, referenceCapacity: 270, safeCapacity: 269 },
  quote: { safeRect: { x: 40, y: 92, width: 290, height: 360 }, unitsPerLine: 18, maxLines: 15, referenceCapacity: 270, safeCapacity: 269 },
  notice: { safeRect: { x: 36, y: 54, width: 298, height: 384 }, unitsPerLine: 18, maxLines: 16, referenceCapacity: 288, safeCapacity: 287 },
})
```

- [ ] **Step 2: Run the focused test and observe RED**

Run from `miniprogram`:

```powershell
npm.cmd exec -- vitest run src/utils/__tests__/text-note.test.ts --pool=forks --maxWorkers=1
```

Expected: fail because `getTextNoteBodyLayout` and the six layout values do not exist.

- [ ] **Step 3: Implement the immutable layout table and theme-aware options**

Create `TextNoteBodyLayout` with `safeRect`, `fontFamily`, `fontSize`,
`lineHeight`, `unitsPerLine`, `maxLines`, `referenceCapacity`, and
`safeCapacity`. Normalize unknown themes to `paper`. When callers explicitly
pass `unitsPerLine` or `maxLines`, preserve the existing custom-test behavior
and derive `maxVisualUnits` from those overrides unless supplied.

- [ ] **Step 4: Add failing boundary and wide-ASCII tests**

For every theme, assert that `'字'.repeat(layout.safeCapacity)` stays on one
body page and one extra character creates a second body page. Assert that
`'W'.repeat(400)`, long URLs, Emoji, and manual breaks never exceed the theme
budget and reconstruct the normalized input exactly.

- [ ] **Step 5: Run the focused test and observe RED**

Run the command from Step 2. Expected: boundary or wide-ASCII assertions fail
under the old global `17 × 15` and uniform ASCII weight.

- [ ] **Step 6: Implement the page-fit predicate and calibrated ASCII weights**

Make every page satisfy both visual line count and total visual-unit capacity.
Use weight `1` for `W/M/m/w/@/#/%/&`, retain conservative category weights for
other ASCII, and keep Emoji graphemes indivisible at weight `1.6`. Prefer
`Intl.Segmenter` for UAX grapheme boundaries and retain a bounded fallback for
environments without it. Split pathological clusters longer than 16 code points
into source-preserving fallback fragments no longer than 16 code points and
promote fragment boundaries to hard page boundaries; normal UAX clusters remain
indivisible. Segment the normalized body once, then incrementally accumulate
line and visual-unit metrics instead of repeatedly segmenting every candidate
page prefix.
`createTextNoteDeck` must call:

```ts
const bodyPages = paginateTextNoteBody(body, { theme })
```

- [ ] **Step 7: Run the focused test and observe GREEN**

Run the command from Step 2. Expected: all `text-note.test.ts` tests pass with
source-complete pagination.

### Task 2: Render from the same safe-area contract

**Files:**
- Modify: `miniprogram/src/utils/__tests__/text-note-detail-readability-static.test.ts`
- Modify: `miniprogram/src/components/TextNoteCover.vue`
- Modify: `scripts/test-text-note-static.mjs`

**Interfaces:**
- Consumes: `getTextNoteBodyLayout(normalizedTheme)`.
- Produces: `bodyStyle`, applied only to `.text-note-cover-body` when
  `pageKind === 'body'`.

- [ ] **Step 1: Write the failing renderer contract test**

Require `TextNoteCover.vue` to import `getTextNoteBodyLayout`, bind
`:style="bodyStyle"` to the body text node, use `28rpx / 42rpx`, and preserve
the six readable body colors. Require the body style to derive left, top,
width, max-height, and font-family from the shared layout. Update the repository
static gate to reject a return to one global body inset or the old
`30rpx / 44rpx` typography.

- [ ] **Step 2: Run the focused renderer tests and observe RED**

Run from `miniprogram`:

```powershell
npm.cmd exec -- vitest run src/utils/__tests__/text-note-detail-readability-static.test.ts src/utils/__tests__/text-note.test.ts --pool=forks --maxWorkers=1
```

Expected: fail because the renderer still uses one hard-coded
`7.567% / 9.839% / 84.324% / 72.289%` body box and `30rpx / 44rpx`.

- [ ] **Step 3: Implement computed body geometry**

Compute percentage values against `370 × 498`:

```ts
const bodyStyle = computed(() => {
  if (!isBodyPage.value) return undefined
  const layout = getTextNoteBodyLayout(normalizedTheme.value)
  return {
    left: `${(layout.safeRect.x / 370) * 100}%`,
    top: `${(layout.safeRect.y / 498) * 100}%`,
    width: `${(layout.safeRect.width / 370) * 100}%`,
    maxHeight: `${(layout.safeRect.height / 498) * 100}%`,
    fontFamily: layout.fontFamily,
  }
})
```

Bind it only on the body `<text>` and set the shared body typography to
`28rpx` font size and `42rpx` line height. These values preserve the approved
card-relative `16px / 24px` rhythm after the production page margins are
applied; `32rpx / 48rpx` is relative to the whole viewport and overfills the
card.

- [ ] **Step 4: Run focused renderer tests and observe GREEN**

Run the command from Step 2. Expected: both files pass.

Then run:

```powershell
npm.cmd run test:mp:text-note-static
```

Expected: the repository-level text-note contract passes.

### Task 3: Approved prototype and repository verification

**Files:**
- Add: `prototype/text-note-capacity-h5/index.html`
- Add: `prototype/text-note-capacity-h5/styles.css`
- Add: `prototype/text-note-capacity-h5/app.mjs`
- Add: `prototype/text-note-capacity-h5/capacity.mjs`
- Add: `prototype/text-note-capacity-h5/capacity.test.mjs`
- Add: `prototype/text-note-capacity-h5/prototype.test.mjs`
- Add: `docs/superpowers/specs/2026-07-24-text-note-template-capacity-design.md`
- Add: `docs/superpowers/plans/2026-07-24-text-note-template-capacity.md`

**Interfaces:**
- Produces: local review URL `/prototype/text-note-capacity-h5/`.
- Consumes: the six committed `0723/*.jpg` production backgrounds.

- [ ] **Step 1: Run prototype tests**

```powershell
node --test prototype/text-note-capacity-h5/capacity.test.mjs prototype/text-note-capacity-h5/prototype.test.mjs
```

Expected: 7 tests pass.

- [ ] **Step 2: Run product regression suites**

```powershell
npm.cmd --workspace miniprogram exec -- vitest run src/utils/__tests__/text-note.test.ts src/utils/__tests__/text-note-detail-readability-static.test.ts src/utils/__tests__/archive-publish-ui-static.test.ts src/utils/__tests__/detail-carousel-safety-static.test.ts --pool=forks --maxWorkers=1
npm.cmd run test:mp:text-note-static
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
npm.cmd run docs:check
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Inspect real responsive output**

Open the H5/create and detail paths at `390 × 844` and `402 × 917`. Check all
six themes, the first and final body page, theme-switch repagination, and
source-complete page counts. Confirm no body text crosses its approved
safe-area edge.

- [ ] **Step 4: Commit and publish through the protected PR workflow**

Confirm AngryBird Git identity, exact cwd/branch/HEAD, and a clean post-commit
worktree. Push `codex/text-note-template-h5`, create a ready PR with test
evidence and no deployment claim, follow exact-HEAD CI and review, arm Merge
Queue, monitor to `MERGED` or `CLOSED`, then retire this worktree from
`C:\Project\Claude\happyHome_public`.
