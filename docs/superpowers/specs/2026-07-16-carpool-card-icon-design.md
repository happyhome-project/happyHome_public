# Carpool Card Icon Design

## Problem

The home live-collaboration card renders the collaboration template icon as text. Production data for the affected post is correct: it references the protected `carpool` template, whose icon is the standard `🚗` code point (`U+1F697`). In the reported mini-program runtime that glyph is unavailable and renders as a missing-glyph box.

## Scope

- Fix only the carpool card icon on the home live-collaboration surface.
- Keep collaboration template data and the existing `icon` field unchanged.
- Do not change the section heading, card copy, or icons for other collaboration templates.

## Design

Map the stable `carpool` system key to the existing `/static/publish-icons/car.svg` asset when building a home live item. Add an optional image source to the view model. The template renders an `<image>` when that source is present and preserves the current text-glyph path for all other templates.

This removes the carpool icon's dependency on host Emoji fonts while retaining backward compatibility for existing and custom template icons.

## Verification

- A static regression test proves that the carpool system key selects the existing SVG and that the template has image/text fallback branches.
- Existing section-icon unit tests continue to pass.
- The mini-program build succeeds.
- Rendered H5 verification confirms the SVG occupies the existing icon container without layout regression; mini-program release UI validation is used when the shared validation lease and DevTools state allow it.

## Risks

SVG support already exists throughout this uni-app mini-program and the exact asset is already used by the publish surface. The change does not modify production data or cloud behavior.
