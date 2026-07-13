# Figma 0710 Visual Alignment Design

> **Current task contract:** This specification records the user-approved scope for aligning the mini-program with Figma `社区资源共享_小程序_0710`. Search remains explicitly out of scope.

## Source of truth

- Figma file: `社区资源共享_小程序_0710`.
- File key: `a0yB3Ht7e3LZ1FguQdft7L`.
- Home: node `20001:13955`, `2.1.首页`, 402 x 1236.
- Logged-in profile: node `20001:14442`, `4.1.我的`, 402 x 874.
- Logged-out profile: node `20032:1165`, `4.2.我的-未登录`, 402 x 874.
- The earlier `社区资源共享_小程序_0709_v2` file is not an implementation source for this task.

## Scope

Implement only the five approved visual corrections:

1. Remove ordinary-user visibility of `DEV 登录`, the visible build version, and the Home diagnostics card from the profile page.
2. Render home section navigation as text-only horizontal tabs, without emoji or icon glyphs.
3. Convert `rich_text` values used as home/section card titles to safe plain text so tags such as `<p>` never appear.
4. Keep the community switch control visible while a long community title truncates on narrow screens.
5. Restore the logged-in profile identity area to the Figma structure with only the light `编辑` affordance; retain Web logout as a bottom account action.

Search UI, post/detail layout, publish layout, backend contracts, routes, and data migrations are out of scope.

## Visual behavior

### Home masthead

The left masthead container fills the space before the platform capsule. The avatar and community title share the remaining width; the title is one line with ellipsis. The switch control never shrinks or disappears.

### Home section navigation

Tabs are plain text in one horizontal no-wrap row. Selection continues to use the existing active typography/color treatment. Section icon metadata remains available for other content surfaces that still use real local icons, but the tab row does not render glyphs.

### Ordinary card titles

`rich_text` title fallback is converted to plain text in the shared widget formatter. Block boundaries and `<br>` become spaces, basic entities are decoded, scripts/styles and tags are removed, and whitespace collapses. Detail rendering continues to use its existing rich-text renderer.

### Profile

The logged-out identity block contains the avatar and `登录` only. Developer login and Home diagnostics remain available only behind explicit local developer opt-in and never appear by default. Build identity remains machine-readable as a non-visual root data attribute for release validation.

The logged-in identity block retains avatar, name/badge, community/switch, and `编辑`. H5 account logout moves to the bottom action area after community logout, using the existing logout behavior.

## Verification

- Add failing static/unit assertions for all five visual contracts before implementation.
- Run focused tests after each correction, then the complete mini-program unit suite, type-check, and `mp-weixin` build.
- Capture Figma 0710 and implementation screenshots at matching states and viewport.
- Run native DevTools validation for home, guide detail, and logged-out profile without upload or deployment.
- Keep search excluded from validation findings for this task.

## Risks and boundaries

- Removing visible version text requires release validation to read the root data attribute instead of page text.
- H5 logout and community exit are distinct actions and both remain available.
- Plain-text conversion applies only to summary/title formatting; it must not alter stored content or rich-text detail rendering.
- Platform-owned status bar, capsule, and safe areas are compared only in native DevTools evidence.
