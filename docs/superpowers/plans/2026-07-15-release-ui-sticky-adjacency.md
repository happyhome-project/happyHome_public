# Release UI Sticky Adjacency Gate Fix

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-15 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current checked-in release UI gate, and tests.

## Goal

Stop the production release gate from rejecting the correct home layout when the visible topic tabs already sit directly below the pinned search control.

## Root cause

The gate currently requires the tabs to remain more than 8px below the search control in the `searchPinned` sample, but later requires the same edges to be within 8px in the `tagsPinned` sample. Native sticky layout can place the tabs at their sticky boundary during the first sample without overlap, so the first requirement rejects the intended geometry.

## Implementation

1. Change the static release-policy contract first so it rejects the contradictory positive-gap assertion and requires bounded adjacency.
2. Run the focused test and confirm it fails against the current release gate.
3. Replace only the contradictory runtime assertion with the same bounded-adjacency rule already used for the final pinned state.
4. Run focused policy tests, miniprogram unit tests, governance checks, and `git diff --check`.

The home template and styles remain unchanged.
