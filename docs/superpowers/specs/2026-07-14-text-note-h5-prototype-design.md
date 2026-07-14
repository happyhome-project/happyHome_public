# Text Note H5 Prototype Design

> **Historical / point-in-time:** This specification records the pure-text note prototype approved for the 2026-07-14 design review. It does not define current production behavior.
> **Current authority:** Use the [documentation authority map](../../README.md), current HappyHome code and tokens, and the latest approved product decision.

## Goal

Show how a dedicated pure-text section can publish image-free posts without making the two-column home feed look like it contains missing images.

The prototype uses the working section name “邻里随手记”. The production section name remains configurable.

## Product decision

- Model the future section as `displayTemplate: 'text_note'`; do not loosen the image requirement of `guide_note`.
- Turn the first paragraph of the body into a fixed 4:5 text cover instead of rendering an empty image placeholder.
- Let the author select one of three original themes: `paper`, `mint`, or `slate`.
- Keep the publish form image-free and omit topics and “AI帮你写”.
- Keep the full post as accessible text. The cover is HTML text, not a generated bitmap.

## Prototype flow

1. Compose a required title and required body, then select a text-cover theme.
2. Preview the complete feed card and continue changing the theme.
3. Publish locally; the new card appears first in the two-column section feed.
4. Open a card to read the complete text detail.

The cover displays at most 64 characters from the normalized first paragraph. Font size steps down at 21 and 41 characters, but the cover ratio never changes.

## Visual system

- Reuse HappyHome page, surface, green, text, radius, and soft-shadow tokens.
- `paper`: warm paper surface with dark neutral text and a restrained green rule.
- `mint`: light green surface with deep green text.
- `slate`: mist-blue surface with blue-charcoal text.
- The feed card keeps the cover, two-line title, author, time, and like count as one object.
- No illustrations, stickers, branded red, decorative gradients, or image placeholders.

## Prototype boundary

The H5 is a local, interaction-complete design artifact under `prototype/text-note-h5/`. It writes only to browser session storage and does not create a real section, post, cloud fixture, API contract, migration, or deployment.

The local model mirrors the intended future production contract:

```ts
type SectionDisplayTemplate = 'default' | 'guide_note' | 'text_note'
type TextNoteTheme = 'paper' | 'mint' | 'slate'

interface TextNotePresentation {
  textNoteTheme?: TextNoteTheme // defaults to paper
}
```

Production implementation and runtime validation require a separate approved plan after visual review.

