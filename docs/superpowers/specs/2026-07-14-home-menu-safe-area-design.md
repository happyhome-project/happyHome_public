# Home Menu Safe Area Design

> **Historical / point-in-time:** This specification records the home-menu safe-area behavior accepted for the 2026-07-14 delivery. It does not override later product or implementation decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current home-page code, WeChat runtime behavior, and tests.

## Goal

Prevent the home-page “切换” control from entering the WeChat mini-program capsule area on devices with different status-bar and menu-button geometry.

## Scope

- Change only the home-page masthead layout.
- Preserve the current avatar, community-title truncation, switch icon, and switch label.
- Apply dynamic spacing only when the WeChat runtime exposes `wx.getMenuButtonBoundingClientRect()`.
- Keep H5 and runtimes without a valid capsule rectangle visually unchanged.

## Design

On page setup/show, read the current window width and the capsule rectangle. Convert that geometry into the additional right inset required inside the already page-padded top bar:

`window width - capsule left - existing page right padding + visual gap`

Clamp the result to zero and ignore missing, non-finite, or out-of-range measurements. Bind the resulting pixel value as inline right padding on `.home-topbar`. Flex layout then keeps the switch control wholly to the left of the capsule while the community title continues to shrink and ellipsize.

The calculation will live in a small pure utility so device geometry and fallback behavior can be unit-tested independently of Vue and WeChat globals.

## Lifecycle

- Measure during initial page setup.
- Re-measure on `onShow`, covering a tab-page return or window/orientation change reported before the page becomes visible.
- A failed measurement resets the extra inset to zero instead of preserving stale geometry.

## Validation

- Unit tests cover normal capsule geometry, different screen widths, invalid measurements, and non-negative clamping.
- A page-level static test verifies that the home top bar consumes the computed inset and that `onShow` refreshes it.
- Type-check and the focused mini-program UI/static suites must pass.
- Final visual verification uses the WeChat mini-program runtime or its release-UI automation; H5 is checked for unchanged fallback layout.

## Non-goals

- No redesign of the masthead.
- No changes to search, banner, tabs, profile, or community-switch pages.
- No fixed device-specific right margin.
