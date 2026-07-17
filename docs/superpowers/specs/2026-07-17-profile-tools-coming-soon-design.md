# Profile Tool Availability Design

> **Historical / point-in-time:** This 2026-07-17 design records the approved profile-tool presentation change. Do not treat its implementation status as current.
> **Current authority:** Use the [documentation authority map](../../README.md), current profile page code, tests, and GitHub PR state.

## Approved visual contract

Keep the existing profile tool card, four-column grid, icons, labels, spacing, and card dimensions unchanged.

- First row, unavailable and visually muted: `我的收藏`, `我的点赞`, `我的归档`, `打卡记录`.
- Second row, available and unchanged: `我发布的`, `我的活动`, `联系客服`.
- Move `打卡记录` into the fourth position and `我的活动` into the sixth position.
- Muted entries use grayscale icons at 38% opacity and `#a8a8a8` labels.
- Muted entries do not navigate or show a misleading action response.
- Do not add badges, helper copy, tooltips, or new layout elements.

## Implementation boundary

The profile tool item model owns availability. The template derives one disabled-state class and skips the existing handler for unavailable entries. Scoped CSS renders only that class differently. No route, API, data, or underlying feature implementation changes are included.

## Verification

- Static/unit contract verifies exact item order, exact unavailable keys, disabled class binding, and guarded event wiring.
- H5 mobile rendering at 390 x 844 verifies the first row is visibly muted while the second row stays unchanged.
- H5 browser interaction verifies that clicking an unavailable item leaves the route and visible page state unchanged, while clicking a working entry still enters its existing flow.
