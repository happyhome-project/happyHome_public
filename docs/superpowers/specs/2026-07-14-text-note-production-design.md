# Text Note Production Design

> **Historical / point-in-time:** This specification records the production design approved through the 2026-07-14 interactive H5 prototype. It does not replace current code or release policy.
> **Current authority:** Use the [documentation authority map](../../README.md), current shared types, cloud validation, admin code, mini-program code, and tests.

## Objective

Add a configurable pure-text section template whose posts remain visually coherent in a two-column feed without requiring or synthesizing images. Preserve the existing `guide_note` image contract unchanged.

## First-principles model

- `Section.displayTemplate` is the source of truth for the content contract. Add `text_note` as a third template; do not infer it from a section name.
- `Post.content` contains administrator-defined user content. A text-note section owns two locked required widgets: `text_title` (`short_text`) and `text_body` (`rich_note`).
- `Post.presentation` contains bounded visual metadata. Add `presentation.textNoteTheme`, allow exactly `paper | mint | slate | headline | quote | notice`, default missing values to `paper`, and reject explicitly invalid values.
- A cover is a deterministic view over title, the first body paragraph, and theme. It is rendered by the client as HTML/view nodes; no cover image is generated, uploaded, or stored.
- The cloud function is the security boundary. `text_body` must reject embedded images even if a client submits them.

## Administration

- Administrators can create an evergreen section with “纯文字笔记”. Creation atomically installs the two locked widgets.
- Locked widget type, key, required state, order, and list-visibility cannot be removed or changed.
- This delivery does not migrate existing sections or posts.
- Changing the template of an existing section with posts is rejected. Template changes for empty sections must update the fixed-widget contract atomically; if the existing command cannot provide that safely, the UI disables template changes after creation and the server rejects them.

## Authoring

The mini-program create page uses the approved two-step flow only for `text_note`:

1. Write a required title and required image-free rich-note body. No image control, topic tool, or “AI帮你写” appears.
2. Render the real title and first paragraph in a 4:5 cover. Six horizontally selectable styles update the preview immediately. The author can return without losing content or publish with the selected theme.

The existing default and guide flows remain unchanged.

## Display

- A shared pure function derives safe title, first paragraph, Unicode-safe 64-character cover text, size band, and normalized theme.
- A reusable `TextNoteCover` component renders the six themes at a fixed 4:5 ratio with overflow protection.
- Home and section pages route only `displayTemplate === 'text_note'` into the two-column text-note card layout.
- The detail page reuses the current default rich-note detail rendering; the visual cover is not repeated unless required by the existing detail composition.
- Missing presentation on historical/old-client posts falls back to `paper`.

## Compatibility and delivery boundary

- `guide_note` remains image-required and its rendering/upload behavior is untouched.
- Default sections remain unchanged.
- No database migration is required because the added fields are optional in document storage.
- This feature branch may build and test locally, but must not deploy cloud functions, modify shared cloud state, upload a mini-program build, or publish production.

## Acceptance

- Admin creates a `text_note` section and receives exactly the two fixed widgets.
- A member publishes without an image through the two-step flow; stored content and theme match the request.
- Empty title/body, embedded body images, and invalid explicit themes are rejected server-side.
- Home and section views show 4:5 two-column covers for all six themes; default and guide regressions remain green.
- Detail shows the complete rich-note body.
- Short/long Chinese, paragraph breaks, Emoji, continuous English, and long URLs do not overflow.
