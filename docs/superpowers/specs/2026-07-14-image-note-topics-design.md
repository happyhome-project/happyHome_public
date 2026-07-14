# Image Note Topics Design

> **Historical / point-in-time:** This specification records the image-note and topic-control design accepted for the 2026-07-14 delivery. It does not override later product, implementation, or release decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current repository rules, checked-in code, and tests.

## Goal

Add a reusable `#话题` widget and a community-available image-note section template named `图文_new`. The experience follows the compact publishing and two-column content rhythm selected from the Xiaohongshu-style option A, while leaving the existing `亲子出游` guide template and route data unchanged.

## Product boundaries

- Every community administrator can choose the new `图文_new` template when creating an evergreen section.
- Existing and future communities do not receive a section automatically. Selecting the template creates the section inside that community and preconfigures its locked widgets.
- The template contains only images, title, body, topics, and location. It does not contain distance, altitude, climb, duration, drive time, track ID, or activity-invite controls.
- This delivery does not add topic feeds, topic following, trending topics, or a topic-management collection.
- The existing `guide_note` template, its locked widgets, legacy name fallbacks, cards, details, and historical posts remain unchanged.

## Template and widget contracts

Extend `SectionDisplayTemplate` with `image_note` and expose it in the administration UI as `图文_new`. Its locked widget set is:

| Order | Widget ID | Type | Label | Required | Stored value |
| --- | --- | --- | --- | --- | --- |
| 0 | `image_note_images` | `image_group` | 添加图片 | yes | cloud file ID array |
| 1 | `image_note_title` | `short_text` | 主题 | yes | string |
| 2 | `image_note_body` | `rich_note` | 正文 | no | existing rich-note value |
| 3 | `image_note_topics` | `topic` | 话题 | no | normalized string array |
| 4 | `image_note_location` | `location` | 设置地点 | no | existing `GeoLocation` value |

Add `topic` to the reusable `WidgetType` union so ordinary configurable sections can also add it. A topic value is stored without the leading `#`. Normalize Unicode to NFKC, trim outer whitespace, strip leading `#` characters, discard empty values, deduplicate by normalized comparison while preserving first-entered display text, limit each topic to 20 Unicode characters, and limit a post to five topics. Apply the same rules to member publishing, admin creation, and admin editing.

No new collection, index, migration, or topic API is introduced. Topic values remain within the existing `Post.content` widget map. Old posts without the new widget render normally.

## Member experience

### Publishing

- Render a template-specific white publishing canvas: image picker first, then a stronger title field and an open body field.
- Place `# 话题` and `设置地点` as compact pills in one tool row below the body, matching approved option A. Use the selected visual direction: black primary text, restrained gray separators, and a red publish/active accent within this template rather than changing the global HappyHome theme.
- Tapping `# 话题` opens a bottom sheet with a text input, an add action, selected topic chips, and per-chip removal. It supports free entry only; it does not query or persist recommendations in this delivery.
- Selected topics appear above the tool row as `#话题` chips. The UI prevents a sixth topic and explains the five-topic limit.
- Tapping `设置地点` reuses the current map/location selection flow. The selected place replaces the placeholder pill and remains removable. Location permission denial or cancellation leaves the draft intact.
- Images and title are required. Body, topics, and location are optional. Existing draft, upload, submit-lock, audit, and error-recovery behavior remains active.

### Feed and detail

- Home and the section page render `image_note` posts as a two-column masonry-style feed: cover, two-line title, author avatar/name, and like count. Do not show route statistics or destination text on cards.
- Preserve each cover's natural visual ratio within bounded card dimensions; resolve cloud image URLs through the existing media pipeline and show the current safe placeholder on failure.
- The detail page presents an edge-to-edge image swiper, author row, title, body, topic chips, and an optional `设置地点` row, followed by the existing like/comment interaction area.
- Topic chips are display-only in this delivery. They do not navigate to a topic page.

## Administration and compatibility

- Add `图文_new` beside the current default and guide templates in section creation/editing. Choosing it installs and locks the five template widgets; custom widgets may follow the locked set using the same normalization pattern as `guide_note`.
- Add the reusable `话题` type to the widget editor and provide a tag-entry editor in admin post creation/editing.
- Template normalization is keyed by `displayTemplate`, never by the literal section name. Renaming a section must not change its behavior.
- Changing an existing section into or out of `image_note` follows the same guarded normalization contract as `guide_note`; existing post content is not deleted.
- Public cloud/admin interfaces, shared types, mini-program types, and tests must all recognize `image_note` and `topic`. No production data or infrastructure mutation occurs from a feature worktree.

## Validation and rollout

- Unit tests cover template normalization, locked/custom widget ordering, topic normalization and limits, required fields, and member/admin post create/edit validation.
- UI tests cover the option-A tool row, topic sheet add/remove/limit behavior, optional location selection/clear, image-note cards, and image-note detail ordering.
- H5 validation uses a lease-protected temporary `图文_new-<runId>` section and post in the fixed test community: publish images/title/body/topics/location through the real UI, verify API and rendered feed/detail values, then remove the fixture.
- Build and type-check both H5 and `mp-weixin`; repeat the critical publish/feed/detail path in isolated WeChat DevTools before release evidence is accepted.
- Deliver through a feature PR, required PR CI, and Merge Queue. Deployment remains a separate canonical-main release task. After release, community administrators may create `图文_new` sections; there is no bulk section creation for existing communities.
