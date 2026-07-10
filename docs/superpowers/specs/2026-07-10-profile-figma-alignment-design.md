# Profile Figma Alignment Design

## Source of truth

- Figma file: `社区资源共享_小程序_0709_v2`, file key `s9qznMHulxrBryT7Hwj2El`.
- Logged-in reference: node `20001:14442`, `4.1.我的`, 402 x 874.
- Logged-out reference: node `20032:1165`, `4.2.我的-未登录`, 402 x 874.
- Shortcut reference: node `20001:14460`; tool-grid reference: node `20036:4085`.
- The Figma file does not contain a separate edit-profile frame. The existing same-route edit state remains the behavior contract and adopts the confirmed profile visual language.

## Goal

Make the mini-program profile surface visually match the Figma profile frames while preserving current login, avatar selection, nickname editing, community actions, sharing, contact-service, and leave-community behavior.

## Visual structure

1. The profile page uses custom navigation so its background reaches the physical top edge. The operating system status bar and WeChat capsule remain platform-owned; the app renders only the `我的` title and reserves their safe areas.
2. The page background follows the Figma 188.63-degree progression: `#CFF5F2` near the top, white through the user/shortcut region, then `#F2F3F7` for the content floor.
3. The logged-in and logged-out identity blocks keep a 64 px avatar and Figma typography. Existing admin badge, community switch, and edit controls remain data-driven.
4. Create/join shortcuts are two 179 x 76 px cards at the 402 px reference width, separated by 12 px. Each card uses its Figma background decoration and exact local vector icon.
5. The seven profile tools use the Figma vector assets, a four-column grid, approximately 40 px icon slots, 14/22 px labels, and two rows. Character glyph approximations are removed.
6. Edit profile remains an in-page state. It uses the same top-to-bottom gradient shell, a white 16 px-radius form card, centered avatar editor, nickname input, and equal cancel/save actions. No new route or backend contract is introduced.

## Asset policy

Figma MCP asset URLs are temporary. Required icons and decorations are downloaded during implementation and committed under `miniprogram/src/static/profile/`; runtime code never depends on the expiring Figma URLs.

## Error and platform behavior

- The custom header uses `env(safe-area-inset-top)` plus a stable navigation row and does not draw a fake status bar or WeChat capsule.
- Existing avatar fallbacks and H5 choose-avatar test hook stay intact.
- Existing click handlers and disabled/loading states remain unchanged.

## Verification

- Add a failing static regression check for custom profile navigation, local assets, image-based icons, Figma shortcut decorations, and removal of character icons.
- Run mini-program type checking, unit tests, H5 build, and mp-weixin build.
- Exercise logged-in profile, edit-open, cancel, and shortcut/tool interactions in H5 at 402 x 874 and a narrower mobile viewport.
- Capture screenshots and compare top background continuity, card dimensions, grid alignment, icon fidelity, clipping, and edit-state spacing against Figma.

