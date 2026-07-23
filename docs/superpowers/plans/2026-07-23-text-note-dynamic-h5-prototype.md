# Dynamic Text Note H5 Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local interactive H5 sample that demonstrates HappyHome text editing, visible layout generation, multi-page themed cards, publishing into a two-column feed, and paged detail reading.

**Architecture:** Add a framework-free ES module prototype under `prototype/text-note-dynamic-h5/`. Keep pagination and cover-excerpt selection in a pure module with Node tests; keep rendering and interaction state in a separate browser module. Reuse the six production SVG cover assets from `miniprogram/src/static/text-note-covers/`.

**Tech Stack:** HTML5, CSS, browser ES modules, Node built-in test runner, Vite dev server from the existing repository dependencies.

## Global Constraints

- Do not reuse or modify `prototype/text-note-h5`.
- Do not modify Figma, production APIs, cloud data, or mini-program production behavior.
- Do not add image upload, Markdown, or AI writing.
- Keep every generated card at `4:5`; paginate before shrinking below the readable type floor.
- Keep topic and location tools on the second step.
- Use the six existing production text-note SVG assets.

---

### Task 1: Pure layout engine

**Files:**
- Create: `prototype/text-note-dynamic-h5/layout.mjs`
- Create: `prototype/text-note-dynamic-h5/layout.test.mjs`

**Interfaces:**
- Produces: `normalizeBody(text)`, `selectCoverExcerpt(body)`, `paginateBody(body, options)`, and `createTextNoteDeck({ title, body, theme })`.
- `createTextNoteDeck` returns `{ theme, pages }`, where each page contains `kind`, `title`, `body`, `pageNumber`, and `totalPages`.

- [ ] **Step 1: Write failing tests**

Cover cases for salutation skipping, paragraph preservation, no lost or duplicated text, URL/Emoji safety, short one-page content, and long multi-page content.

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test prototype/text-note-dynamic-h5/layout.test.mjs`

Expected: FAIL because `layout.mjs` does not exist.

- [ ] **Step 3: Implement the minimum deterministic layout engine**

Use paragraph boundaries first, sentence boundaries second, and Unicode-safe character splitting only as fallback. Apply theme-specific page capacities and preserve normalized source order.

- [ ] **Step 4: Run the tests**

Run: `node --test prototype/text-note-dynamic-h5/layout.test.mjs`

Expected: all tests pass.

### Task 2: Interactive H5 surface

**Files:**
- Create: `prototype/text-note-dynamic-h5/index.html`
- Create: `prototype/text-note-dynamic-h5/styles.css`
- Create: `prototype/text-note-dynamic-h5/app.mjs`

**Interfaces:**
- Consumes: `createTextNoteDeck` from Task 1.
- Produces: hash routes `#/compose`, `#/preview`, `#/home`, and `#/detail`.

- [ ] **Step 1: Build semantic route containers and shared mobile app chrome**

Create code-native controls for back navigation, title/body editing, generation status, page and theme rails, publish tools, feed cards, and detail navigation.

- [ ] **Step 2: Implement the generation and theme-regeneration state machine**

Use explicit `editing`, `generating`, `preview`, `published`, and `detail` states. Prevent duplicate generation, preserve edits on failure, and update the page count after every theme change.

- [ ] **Step 3: Implement the six complete visual theme variants**

Reuse the production SVGs and give each theme distinct cover/body typography, alignment, spacing, rules, panels, and page decoration.

- [ ] **Step 4: Implement topic and location interactions**

Provide local bottom sheets, selected values, cancel/confirm behavior, and second-step placement matching the image-note tools.

- [ ] **Step 5: Implement publish-to-feed and detail reading**

Insert the new cover at the top of a balanced two-column mock feed and reuse the exact generated deck in the detail carousel.

### Task 3: Automated and rendered verification

**Files:**
- Create: `prototype/text-note-dynamic-h5/prototype.test.mjs`
- Modify: `prototype/text-note-dynamic-h5/index.html`
- Modify: `prototype/text-note-dynamic-h5/app.mjs`

**Interfaces:**
- Consumes: stable `data-testid` attributes from the H5 surface.
- Produces: repeatable tests for route markup and generation controls.

- [ ] **Step 1: Add static contract tests**

Assert all four routes, six themes, generation phases, topic/location tools, and published detail states are present.

- [ ] **Step 2: Run unit and contract tests**

Run:

```powershell
node --test prototype/text-note-dynamic-h5/layout.test.mjs prototype/text-note-dynamic-h5/prototype.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Start the local Vite server**

Run from the feature worktree:

```powershell
miniprogram\node_modules\.bin\vite.cmd . --host 127.0.0.1 --port <free-port> --strictPort
```

- [ ] **Step 4: Verify the core workflow in the in-app browser**

Exercise:

```text
#/compose → edit → generate → #/preview → switch theme → select topic/location
→ publish → #/home → open first card → #/detail
```

Check `390×844` and desktop viewport, console health, page identity, no blank page, no framework overlay, screenshot evidence, and interaction proof.

- [ ] **Step 5: Compare against the accepted current-product reference**

Use the latest formal compose and preview screenshots as the reference. Inspect copy, palette, typography, button geometry, spacing, SVG treatment, responsive behavior, and interaction state. Fix every material mismatch before handoff.

