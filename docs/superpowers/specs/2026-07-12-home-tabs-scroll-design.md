# Home Tabs Scroll Design

## Goal

Make the mini-program home-page category tabs transition into their pinned state without a visible jump, duplicate-control handoff, or a search panel dropping in from above.

## Approved interaction

Use option A: the primary search field remains part of normal page flow and scrolls away. The existing category tabs remain a single rendered control and become pinned at the top when their natural position reaches the safe-area boundary.

## Structure

- Render one category-tabs `scroll-view` only.
- Keep the tabs in document flow so their occupied height never collapses at the pinning threshold.
- Apply sticky positioning to that same tabs container, below the top safe area.
- Preserve the current selected category, horizontal scrolling, tab tap behavior, archive content, and home-tab retap-to-top behavior.
- Remove the duplicated fixed search-and-tabs container and the scroll-threshold measurement/state used only to switch between the two copies.

## Motion and visual treatment

- Do not animate the tabs from outside the viewport.
- Do not fade or collapse the in-flow tabs at the threshold.
- Add the elevated surface, subtle shadow, and opaque/near-opaque background directly to the sticky tabs while it is pinned-capable, so content remains readable beneath it.
- Keep motion limited to the page's native scroll. No synthetic scroll restoration is introduced for the sticky transition.

## Edge cases

- With no archive groups, render no tabs, matching current behavior.
- Switching between long and short archive groups must not change the user's current page scroll position.
- Safe-area padding must keep tabs below the device status area.
- H5 is the first isolated reproduction surface; the final confidence check includes an mp-weixin build and an isolated native replay/manual pass when available.

## Verification contract

- A focused static regression test proves there is one tabs structure, no duplicated fixed-controls structure, and no threshold-driven collapse class.
- Mini-program type-check, unit tests, and mp-weixin build pass.
- At a mobile H5 viewport, screenshots immediately before and after the former threshold show no content jump and only the tabs remain pinned.

## Out of scope

- Redesigning tab labels, icons, colors, or archive content.
- Changing search behavior.
- Modifying the bottom application tab bar.
- Dependency upgrades or audit remediation.
