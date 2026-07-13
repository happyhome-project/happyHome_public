# Figma 0710 Full Visual Fixes Design

> **Historical / point-in-time:** This specification records the visual correction scope approved for the 2026-07-13 Figma 0710 full-page audit follow-up.
> **Current authority:** Use the [documentation authority map](../../README.md), the current Figma `社区资源共享_小程序_0710` source, checked-in code, and tests. Search and the auxiliary writing entry remain out of scope.

> **Approved scope:** This design records the corrections approved after the full-page Figma 0710 audit. The user's latest decision explicitly excludes the auxiliary writing entry from implementation.

## Source of truth

- Figma file: `社区资源共享_小程序_0710`, file key `a0yB3Ht7e3LZ1FguQdft7L`.
- Search frames remain out of scope.
- Current business routes, section configuration, permissions, and stored data remain authoritative.
- Figma example copy and fixture content are visual references only; implementation must not copy placeholder data.

## Goal

Correct the confirmed visual mismatches from the 18-state audit while preserving existing business behavior and avoiding speculative changes to states that were not reproduced.

## Confirmed corrections

### Home empty state

When the selected community section has no visible posts, render the Figma 0710 empty state beneath the masthead and search area:

- real exported empty-state artwork;
- title `暂无社区内容`;
- description `这里还没有帖子，成为第一个分享的人吧`;
- primary action `去发布帖子` that opens the existing publish sheet.

The state must not appear while data is loading, when no community is selected, or when the selected section has content.

### Plain-text detail hierarchy

The default detail first screen must prioritize post information rather than repeat section information:

- native/custom navigation title continues to identify the current detail route;
- the first content heading is the post title;
- author avatar, author name, and publish date follow the title;
- section labels, pinned, featured, and source metadata remain secondary and must not replace the post title;
- widget body order and stored content remain unchanged.

### Notice detail hierarchy

Keep `/pages/notice/index` as an independent route. Align its visual hierarchy to Figma 0710:

- page title `公告详情`;
- author/avatar and date row before the body;
- plain white page without the decorative notice card/accent strip;
- existing missing/error state remains available.

No backend or route changes are allowed.

### Publish experience

- Publish sheet height is content-driven. One row must be shorter than the two-row Figma state; two rows must fit without excess blank space and retain safe-area padding.
- Known section names keep their semantic icons. Unknown sections use one stable neutral publish icon instead of an array-index-based rotating icon.
- The create form keeps only the platform navigation back control. The second in-content back arrow is removed; section re-selection remains available through the existing section-selection flow when entering without an intent.
- Location and map affordances use real local image assets. Text glyphs and CSS-drawn map graphics are removed.
- No auxiliary writing entry is added anywhere.

### Profile editing

The logged-in profile remains rendered while editing. Tapping `编辑` opens a modal layer matching Figma 0710:

- dimmed full-page mask;
- bottom sheet with rounded top corners;
- title, editable avatar, nickname row, cancel, and save actions;
- existing avatar-capability fallback text remains available but visually secondary;
- save/cancel behavior and validation are unchanged;
- AppTabBar stays behind the mask and is not interactive while the sheet is open.

## Reproduced-risk boundary

The audit identified possible risks in native pull-to-refresh, sticky controls, guide detail, and tagged detail. These states are validation requirements, not pre-authorized redesigns. Modify them only if a matching fixture or native DevTools run reproduces a visible mismatch against Figma 0710.

## Testing and evidence

- Every production change begins with a failing static/unit contract.
- Focused tests cover empty-state gating/action, detail hierarchy, notice hierarchy, adaptive publish sheet, stable fallback icon, single navigation back, real location assets, and profile bottom sheet.
- Run the complete mini-program unit suite, type-check, H5 build, mp-weixin build, and existing Figma static checks.
- Capture current implementation and Figma at 402 x 874 in the same comparison image for each corrected surface.
- Native-only states require the machine validation lease; no deployment, upload, shared fixture write, or shared environment mutation is permitted.

## Out of scope

- Search.
- Auxiliary writing entry.
- Route consolidation.
- Backend, schema, migration, environment, or shared-data changes.
- Copying Figma placeholder content or test-only section names.
- Speculative redesign of unreproduced risk states.
