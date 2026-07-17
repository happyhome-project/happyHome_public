# Video Publish Design

## Objective

Add first-class member video publishing to the existing unified publish entry. The first selected media determines whether the member creates an image post or a video post. Audio publishing and mixed image/video posts are out of scope.

## Product Decisions

1. Keep one global publish entry.
2. Let the first selected media choose the post type:
   - image selection continues into the existing multi-image flow;
   - video selection starts a single-video flow.
3. Add `video` as a third archive post format beside `image_text` and `text`.
4. Do not mix video values into `images: string[]` and do not overload `image_text`.
5. Reuse the existing `VideoItem` model, audit extraction, video renderer, and playback utilities.
6. Do not expose `audio_group` or add an audio archive format.

## Publish Flow

The publish sheet keeps the existing text and collaboration actions and replaces the image-only archive action with a media-oriented entry. Opening it presents the platform media picker.

- Selecting one or more images enters the existing `image_text` editor.
- Selecting one video enters the new `video` editor.
- Image posts remain multi-image posts.
- Video posts contain exactly one locally uploaded video.
- If a user changes media type after selecting content, the UI asks for confirmation before clearing the previous selection.
- Draft storage distinguishes `image_text`, `text`, and `video` so one format cannot restore incompatible media into another editor.

The video editor contains:

- video preview;
- replace/remove action;
- cover preview and cover selection, with a generated or platform-provided thumbnail used when available;
- required title;
- optional body;
- optional topics;
- optional location;
- upload progress, retry, and actionable failure messages.

## Data Contract

Extend `ArchivePostFormat` and all client/server archive-format unions with `video`.

The normalized archive video content is:

```ts
interface ArchiveVideoContent {
  title: string
  body?: RichNoteContent
  videos: [VideoItemCos]
  location?: GeoLocation
}
```

The stored `videos` field deliberately remains a one-element array because every existing
`video_group` consumer (audit, search, RAG, file extraction, and rendering) already uses that
contract. The archive parser enforces exactly one element. The stored COS item is:

```ts
{
  itemId: string
  title: string
  source: 'cos'
  fileID: string
  cover?: string
  hint?: string
}
```

Archive topics remain top-level archive metadata, consistent with existing image and text posts.

## Upload and Validation

Member video upload is separate from the admin upload endpoint. The post function issues a
member-scoped cloud path and upload metadata; it must not grant ordinary users access to admin
actions or external video sources. Before create/update, the server resolves the uploaded object
and verifies its actual response metadata rather than trusting client-supplied size or MIME values.

First-release limits are HappyHome product limits:

- one video per post;
- extensions: `mp4`, `mov`, `m4v`, `webm`;
- maximum size: 200 MB;
- source must be `cos`;
- stored video path must belong to the authenticated member's member-video prefix for this application;
- cover, when present, must be an uploaded image belonging to the application;
- title is required;
- video file ID is required.

The server validates the archive input before persistence. Unknown fields, external URLs, non-COS
sources, zero or multiple video items, additional media fields, and audio fields are rejected rather
than silently ignored. This scoped validation must not enable member writes to administrator-only
video/audio widgets in ordinary sections.

The upload UI validates size and extension before upload, reports progress, supports retry, and does not submit until upload completes. Abandoned or failed submissions record uploaded temporary files for best-effort cleanup using the existing storage cleanup mechanisms where available.

## Audit, Search, and RAG

- Feed the video file and cover into the existing content-audit target extraction.
- Preserve the existing audit-status visibility rules: content that has not passed the required audit must not appear as a normal public post.
- Reuse existing video title/hint search extraction.
- Reuse the existing video RAG worker and its cost controls; this feature does not change RAG enablement or production budgets.

## Feed and Detail Presentation

Archive cards and author-post cards recognize `format: 'video'`.

- The card uses the explicit cover when available.
- If no cover is available, it uses a stable video placeholder rather than pretending the post is text-only.
- The card displays a play affordance so users can distinguish video from image posts before opening it.
- The detail page builds a synthetic archive section containing one `video_group` widget and reuses `VideoPlayerCard` for playback.
- Editing a video post permits metadata changes and replacement/removal through the video editor; it never converts the post into an image post in place.

## Compatibility and Migration

- Existing `image_text` and `text` posts are unchanged.
- Existing administrator-maintained `video_group` sections continue to work.
- No database migration is required because archive post content is schema-validated at the application boundary.
- Older clients that do not recognize `video` may omit or degrade the card; therefore the release must update list normalization and detail projection in the same change.

## Testing and Acceptance

Automated coverage must prove:

1. archive parsing accepts one valid COS video and rejects missing, multiple, external, oversized, or unsupported media;
2. the member create/update path validates video posts without enabling admin-only media for ordinary section posts;
3. the publish picker routes images to `image_text` and a video to `video`;
4. image/video switching requires destructive confirmation;
5. video upload enforces type and size limits and exposes progress/retry state;
6. archive and author feeds expose cover and video identity;
7. detail projection renders the existing video player;
8. audio behavior and existing image/text publishing remain unchanged;
9. mini-program unit tests, type-check, H5 build, and mp-weixin build pass.

Browser or DevTools validation should exercise a temporary video post only when the shared validation lease is available. The fixture must be isolated and cleaned up. If the lease or required media fixture is unavailable, the task must report that the real UI/data loop was not covered rather than treating static checks as equivalent.

## Out of Scope

- audio publishing;
- mixed image/video carousel posts;
- multiple videos in one archive post;
- external H5, app-link, mini-program, live, or Channels sources for member posts;
- new video editing, transcoding, or RAG pricing behavior;
- production deployment or mini-program upload from the feature worktree.
