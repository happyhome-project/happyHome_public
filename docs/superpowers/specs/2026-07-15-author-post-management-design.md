# Author Post Management Design

> **Historical / point-in-time:** This specification records the author-post management design accepted for the 2026-07-15 delivery. It does not override later product or implementation decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current checked-in code, cloud contracts, and tests.

## Goal

Give post authors a Xiaohongshu-inspired management flow and make the existing “我发布的” profile shortcut real. The flow must support actual edit/delete operations and a visual, cover-first view of the author's posts rather than placeholder controls.

## Detail-page author controls

Only the post author sees a quiet lower-left entry labelled `编辑和设置 ›`. Tapping it opens a bottom sheet with a white surface, large rounded top corners, centered `笔记设置` title, and two horizontally arranged actions:

- `编辑`: a neutral circular icon button using the local outline edit asset.
- `删除`: a neutral circular icon button using the local outline delete asset; destructive red is reserved for the existing confirmation dialog.

The old full-width delete area is removed. The sheet closes by tapping the mask, the close button, or an action.

## Real editing

The existing create page gains an `editPostId` mode. It loads the owned post and its section contract, pre-fills the current images, title, body, topics, location, and other editable widgets, changes the submit copy to `保存`, and calls `post.update` instead of creating a second post. Existing `cloud://` images remain unchanged; newly selected local files are uploaded through the current upload path.

Both ordinary section posts and native archive posts are recognized. Archive posts use the existing virtual image/text editor contract. The backend continues to enforce author ownership, widget validation, and content audit before applying edited content.

## “我发布的”

The profile shortcut navigates to a new `pages/my-posts/index` page. The backend `post.listMine` action derives the author from the authenticated identity; the client never supplies an author ID. It returns the caller's non-deleted posts across all communities, newest first, with community and section display metadata.

The page follows Xiaohongshu's profile-note presentation: two cover-first masonry columns, compact title, subdued community/section metadata, and like/comment counts. Image posts use their first image; text posts reuse `TextNoteCover`; other posts receive a restrained section-name fallback. Cards open the existing detail page. Loading, empty, retry, pull-to-refresh, and pagination states are explicit.

## Data and security boundaries

- `listMine` requires login and can only query `authorId = current identity`.
- Deleted posts are omitted; pending/rejected audit states remain visible to their author with a small status label.
- Edit and delete retain backend ownership checks.
- No production deployment, index mutation, or fixture write occurs from this feature worktree.

## Verification

- Cloud unit tests cover identity scoping, sorting/pagination, deleted filtering, and metadata enrichment.
- Static/UI tests cover the horizontal icon sheet, profile navigation, edit-mode routing, and two-column page contract.
- H5 verification covers profile → 我发布的 → detail → settings sheet and edit prefill/save against isolated temporary fixture data, followed by cleanup.
