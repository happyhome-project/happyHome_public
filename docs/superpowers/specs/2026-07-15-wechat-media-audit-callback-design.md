# WeChat Media Audit Callback Design

> **Historical / point-in-time:** This specification records the media-audit callback design accepted on 2026-07-15. It does not override later implementation or operational policy.
> **Current authority:** Use the [formal release gate](../../release-gate.md), current code, production configuration, and tests.

## Goal

Complete the production content-safety loop for user posts containing images or audio. Text checks remain synchronous. Media checks remain asynchronous: the mini program tells the author that review is in progress, and a verified WeChat callback automatically publishes, rejects, or routes the post to manual review.

## Confirmed production failure

On 2026-07-15 a real user image post produced two WeChat text tasks with `suggest=pass` and one WeChat image task with `status=pending` and a valid `traceId`. The image task remained pending because no deployed HTTP/event endpoint accepted WeChat's result. The existing `audit.callback` action is not connected to WeChat and requires a private `AUDIT_CALLBACK_TOKEN` that WeChat does not send.

## Architecture

Add a dedicated `wechat-audit-callback` HTTP function. It owns only WeChat server verification and content-audit result delivery. It must not share admin sessions, admin bearer tokens, or the H5 test gateway.

The function delegates persistence to a focused callback service in `cloud/lib/content-audit.ts` (or a small adjacent module if extraction keeps responsibilities clearer). The adapter normalizes WeChat's snake-case callback payload to the existing audit-task model; the service updates matching tasks by `traceId`, then recomputes the affected post/slot through the existing `applyAuditSummary` path.

## HTTP protocol and trust boundary

- `GET` supports WeChat server URL verification. It validates the WeChat SHA-1 signature calculated from the configured message token, timestamp, and nonce before returning `echostr`.
- `POST` validates the same WeChat signature before parsing or mutating data.
- The callback accepts JSON delivery and the WeChat media-security event shape. It validates the configured `WX_APPID` when an app id is present.
- The initial release uses WeChat plaintext message mode. AES/safe mode is rejected explicitly until a separate design adds encrypted-message handling; the WeChat console must therefore be configured to plaintext mode for this endpoint.
- Secrets are function environment variables: `WX_APPID` and a new strong `WX_MESSAGE_TOKEN`. No secret is committed or logged.
- Unsupported events, invalid signatures, malformed results, and mismatched app ids are rejected before database access.

## State transition

1. `post.create` submits text synchronously and media asynchronously as today.
2. The mini program receives `pending` and displays the already-approved message: “图片正在安全审核，通过后将自动发布”.
3. WeChat sends a media-check event containing `trace_id` and result details.
4. The callback maps WeChat suggestions:
   - `pass`/`normal` -> `pass`
   - `risky`/`block` -> `rejected`
   - `review`/`suspect`/unknown -> `review`
5. Every task matching the exact `traceId` is updated idempotently.
6. Each unique `(postId, contentSlot)` is summarized. All-pass publishes; any rejection rejects; review routes to manual review; remaining pending stays pending.
7. Existing search, archive-topic, and RAG lifecycle hooks remain centralized in `applyAuditSummary`.

## Idempotency and failure handling

- Re-delivering the same result produces the same task and post state. It does not create tasks.
- An unknown `traceId` returns an acknowledged no-op with a sanitized warning so WeChat does not create a retry storm.
- Database or aggregation failures return a retryable HTTP failure.
- Logs contain request category, match count, and final status only; they never contain signatures, tokens, raw post content, media URLs, or full callback bodies.
- The admin audit page continues to show pending/review items. A separate timeout marker is out of scope; operational verification will detect callbacks that remain pending.

## Deployment and configuration

- Register `wechat-audit-callback` as a release cloud component and include it in cloud smoke coverage.
- Provide an idempotent configuration script that preserves existing function variables while setting `WX_APPID` and `WX_MESSAGE_TOKEN`, and verifies that HTTP access exists.
- Configure the Mini Program console's message-push URL to the dedicated HTTPS endpoint, JSON data format, and plaintext mode, using the same message token.
- Production configuration and release remain canonical-main-only operations under `docs/release-gate.md`.

## Tests

- Signature helper: valid signature, wrong token/signature, missing timestamp/nonce.
- GET verification: valid returns `echostr`; invalid returns 403.
- POST adapter: valid pass/rejected/review payloads; malformed payload; app-id mismatch; unsupported event.
- Audit service: exact trace matching, multiple tasks for one trace, multiple post/slot pairs, unknown trace no-op, duplicate delivery idempotency.
- Regression: summary precedence remains rejected > review > pending > pass; archive/search/RAG lifecycle remains unchanged.
- Deployment policy: function is in the release registry, environment policy redacts secrets, and cloud smoke invokes a non-mutating verification branch.
- Production acceptance: create an isolated image post through the real mini-program path, observe text `pass`, media `pending -> pass`, verify automatic visibility, then delete the fixture and verify cleanup.

## Out of scope

- Replacing WeChat media audit with Tencent CI.
- Automatically approving old pending posts without resubmission.
- Encrypted WeChat message mode.
- Polling WeChat for results; no reliable replacement for callback delivery is assumed.
