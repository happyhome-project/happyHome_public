# HappyHome First-Open Performance Design

## Goal

Make a first meaningful branded screen appear without waiting for Home feed code or cloud data, while preparing the public Home snapshot in parallel and preserving all authenticated visibility checks.

## Evidence and causal model

The latest `main` intentionally removed the old guest introduction and sends signed-out users directly to the public Home. The default entry still evaluates the full Home page and declares Home's waterfall, share canvas, note cover, archive tabs, and custom tab bar before any local response can be painted. All fourteen pages are also in the main package.

The startup critical path is therefore:

1. WeChat prepares and downloads the main package.
2. App and current-page JavaScript are injected and evaluated.
3. The full Home page is initialized and rendered.

`post.bootstrap` begins after mount and is not required for a local startup response. Cache-first behavior cannot help a brand-new user. WeChat data pre-fetch can run during package loading, but HappyHome currently returns an empty snapshot when no background token exists and Home skips the pre-fetch read for guests.

## Approved architecture

### Lightweight default entry

Add `pages/startup/index` and make it the mini-program `entryPagePath`. It renders only a local branded routing shell without importing or instantiating Home feed components.

- Every default launch receives a lightweight first paint, then switches to `/pages/index/index` from `onReady`.
- The shell contains no guest introduction or login action, preserving the latest product decision that guest browsing opens directly and login stays on Profile.
- A failed route remains retryable by tapping the shell and is reported only through invisible diagnostics.
- Explicit share/deep-link paths to Home remain unchanged.

### Guest data pre-fetch

When the official pre-fetch request has no token but does have the WeChat-generated `code`, `home-prefetch` returns `buildHomeSnapshot('')`, which contains only the configured active public community and its guest-readable feed. A present but invalid token remains a safe empty response and must never downgrade to guest behavior.

Home starts `getBestBackgroundFetchSnapshot({ openId: '' })` for signed-out users. A valid guest snapshot may expose its public posts immediately; authenticated cache and pre-fetch snapshots remain shell-only until `post.bootstrap` revalidates membership.

### Non-blocking hydration

Profile `user.login` and `user.webLogin` commit the authenticated state and resolve after the identity response. Community directory and membership hydration continue in the background with their existing error containment. A hydration failure never rolls back an already successful login.

### Invisible performance evidence

Use `wx.getPerformance()` to collect `appLaunch`, `downloadPackage`, `evaluateScript`, `firstRender`, `firstPaint`, `firstContentfulPaint`, and `largestContentfulPaint`. Capture is optional and contains only timing/name/type/count data.

- No performance event is uploaded or written synchronously before first paint.
- Startup events are buffered in memory.
- The startup or Home page flushes them into the existing diagnostic store after `onReady`, then existing explicit diagnostic upload controls apply.
- Remove the unconditional `app.launch.start` cloud upload; warnings, errors, verbose logging, and explicit diagnostic capture retain their existing behavior.

## Security and compatibility

- Guest pre-fetch responses have `viewerOpenId: ''` and only use the existing public-community read path.
- A malformed or invalid explicit token returns an empty snapshot.
- The 256 KB serializer guard remains unchanged.
- No nickname, avatar, token, openid, credentials, or location enters performance details.
- Existing Home, share, tab bar, H5, and direct-route paths remain valid.
- No production deployment, fixture creation, or mini-program upload occurs from this feature worktree.

## Acceptance

- Default cold launch compiles to `entryPagePath: pages/startup/index`.
- Startup page has no Home waterfall/share-canvas/custom-tab dependencies.
- Default entry paints the local routing shell before switching Home and does not restore the retired guest introduction.
- Login promises resolve while membership hydration is still pending.
- No-token-with-code pre-fetch returns a public guest snapshot; invalid-token pre-fetch stays empty.
- Guest Home reads pre-fetch once and can apply public posts; authenticated pre-fetch still cannot expose cached posts before bootstrap.
- Startup performance capture makes no cloud request before its explicit post-ready flush.
- Focused tests, mini-program full unit tests, type-check, cloud tests, and the WeChat build pass.
