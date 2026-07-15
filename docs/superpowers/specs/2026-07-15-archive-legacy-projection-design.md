# Historical Archive Display Projection Design

## Problem

The archive migration preserved legacy post records and topic links, but it only added archive metadata. Legacy content remains keyed by section widget IDs such as `guide_title` and `guide_images`, while the archive waterfall reads canonical `content.title`, `content.images`, `content.body`, `content.location`, and top-level `format`. As a result, valid historical posts are returned by production APIs but render as generic or apparently empty cards.

## Chosen approach

Materialize a canonical display projection into each migrated legacy post. Resolve legacy widget IDs through the originating section's `widgets[].fieldKey`, copy supported values into canonical content aliases, and derive `format` from whether canonical images exist. Preserve `sectionId`, every original content field, moderation state, topics, and all unrelated metadata.

This is preferable to client-only special cases because it works for every legacy section schema and becomes visible to the already-published client as soon as production data is repaired. It is preferable to runtime projection because list requests remain a single indexed post/topic query without section lookups.

## Safety and idempotency

- Only posts with `area=archive`, `origin=legacy_section`, and a matching non-realtime section are candidates.
- Existing non-empty canonical fields win; the repair never overwrites a newer canonical edit.
- Original widget-keyed fields remain untouched.
- Dry-run output includes exact candidate/change counts and a SHA-256 plan digest.
- Apply requires the reviewed digest and counts, writes an exclusive before snapshot, uses per-document transactional compare-and-set, and verifies a zero-residual second plan.
- A new immutable release migration records the repair for future environments; historical migration files are not rewritten.

## Verification

Unit tests cover widget-field resolution, canonical-field precedence, media-less posts, idempotency, plan-digest identity, and concurrent-change rejection. Production validation compares before/after records, runs the same indexed queries as `listArchive`, and invokes the public community's deployed `listArchiveTabs` and `listArchive` actions.
