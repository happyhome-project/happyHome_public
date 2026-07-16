# Publish Session Readiness Design

## Goal

Opening 发图文, 写文字, or 发起协作 must use session data that was already established by login and home bootstrap. The create page must not repeat a blocking membership request or interpret an unresolved template request as an empty result.

## Chosen approach

Use the existing Pinia community store as the session source of truth. Active communities returned by `member.myCommunities` or an authenticated home snapshot establish an active membership record immediately. The same store holds the latest global collaboration-template snapshot. Login completes only after a best-effort active-community load, while home bootstrap refreshes both caches.

The create page consumes these cached facts. It does not call `member.myStatus` during ordinary create-page entry or foreground resume. If the current community is present in `myCommunities`, publishing is immediately authorized in the UI. The backend post APIs remain the authoritative security boundary and continue checking membership at submit time.

For collaboration publishing, cached templates render immediately. If the cache has not been hydrated, the page performs one coalesced template request and displays a loading state until it settles. A completed empty response is the only state allowed to render an empty message; a request failure remains an explicit load error rather than an empty-board claim.

## Data flow

1. Login succeeds and loads active communities before reporting login completion.
2. `loadMyCommunities` records every returned active community as active membership.
3. Authenticated home snapshots refresh active memberships and collaboration templates in the same store.
4. All three publish routes construct or select their editor synchronously and consume store readiness.
5. Collaboration publishing fetches templates only when no hydrated cache exists.
6. Submit-time cloud functions continue enforcing membership and template validity.

## Error handling

- A membership-refresh failure after successful authentication does not erase the authenticated user; the next home bootstrap may recover it.
- Unknown membership is not displayed as a false rejection. The create page uses the active-community list and cached status, while the backend rejects stale authorization at submit time.
- Collaboration-template request failure shows the existing load-failure toast and keeps a distinct settled state. It is never labeled as “没有板块”.

## Testing

- Community-store tests prove active-community responses hydrate membership records and stale communities are removed.
- User-store tests prove direct and Web login establish communities before resolving.
- Static create-flow tests prove ordinary publish entry no longer invokes `member.myStatus`, all archive editors remain immediate, and collaboration templates prefer the shared cache.
- Run the full mini-program unit suite, type check, and WeChat build.
