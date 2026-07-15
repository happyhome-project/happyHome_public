# WeChat Media Audit Callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver verified WeChat image/audio audit callbacks so pending user posts automatically become visible, rejected, or manually reviewable.

**Architecture:** A dedicated HTTP cloud function authenticates WeChat delivery and normalizes the media-security event. Existing content-audit persistence remains the single state-transition authority. Release registration, secret configuration, and smoke checks make the endpoint deployable and observable without coupling it to admin authentication.

**Tech Stack:** TypeScript, Node.js 16-compatible crypto/HTTP handling, wx-server-sdk, Jest, Node test runner, CloudBase manager tooling.

---

## File map

- Create `cloud/lib/wechat-callback.ts`: signature validation and HTTP event normalization only.
- Create `cloud/lib/__tests__/wechat-callback.test.ts`: protocol tests.
- Modify `cloud/lib/content-audit.ts`: accept a normalized trusted callback and update tasks/post state idempotently.
- Modify `cloud/lib/__tests__/content-audit.test.ts`: callback persistence and aggregation tests.
- Create `cloud/functions/wechat-audit-callback/index.ts`: HTTP adapter and sanitized responses/logging.
- Create `cloud/functions/wechat-audit-callback/__tests__/index.test.ts`: function-level GET/POST tests.
- Modify `cloud/shared/types.ts`: define the normalized callback result type shared by the adapter and audit service.
- Modify `scripts/lib/release-component-registry.mjs` and tests: include the new cloud component.
- Modify `scripts/cloud-release-smoke.mjs` and tests: verify the callback's non-mutating rejection/health behavior.
- Modify `scripts/update-admin-env.mjs` and its tests: persist `WX_APPID/WX_APPSECRET` to `post` and configure callback secrets without printing them.
- Modify `docs/release-gate.md` and add `docs/changes/wechat-media-audit-callback.md`: document console message-push setup and acceptance evidence.
- Modify the mini-program publish-result copy and its static test only if the current text does not explicitly promise automatic publication.

### Task 1: WeChat signature and payload adapter

**Files:**
- Create: `cloud/lib/wechat-callback.ts`
- Create: `cloud/lib/__tests__/wechat-callback.test.ts`

- [ ] **Step 1: Write failing tests** for canonical SHA-1 token/timestamp/nonce sorting, invalid signatures, GET verification, JSON media-check normalization, app-id mismatch, unsupported event, and malformed detail.
- [ ] **Step 2: Run** `npm.cmd --workspace cloud test -- --runInBand cloud/lib/__tests__/wechat-callback.test.ts` and verify failure because the module is missing.
- [ ] **Step 3: Implement minimal pure helpers**: `verifyWechatSignature`, `parseWechatVerification`, and `parseWechatMediaAuditEvent`. Return a normalized `{ traceId, suggest, label }`; do not access the database.
- [ ] **Step 4: Re-run the focused test** and verify all cases pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(audit): validate WeChat media callbacks"`.

### Task 2: Idempotent audit result application

**Files:**
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/lib/__tests__/content-audit.test.ts`

- [ ] **Step 1: Write failing tests** proving an exact `traceId` updates all matching tasks, recomputes unique post/slot pairs, accepts duplicate delivery, acknowledges unknown traces without mutation, and maps rejected/review precedence correctly.
- [ ] **Step 2: Run** `npm.cmd --workspace cloud test -- --runInBand cloud/lib/__tests__/content-audit.test.ts` and verify the new trusted callback API is missing.
- [ ] **Step 3: Implement** `applyWechatMediaAuditResult({ traceId, suggest, label, rawSummary })`. Persist only normalized fields and a bounded sanitized summary; reuse `refreshPostAuditFromTasks`.
- [ ] **Step 4: Run focused content-audit tests**, then run both callback suites together.
- [ ] **Step 5: Commit** with `git commit -m "feat(audit): apply asynchronous WeChat results"`.

### Task 3: Dedicated HTTP cloud function

**Files:**
- Create: `cloud/functions/wechat-audit-callback/index.ts`
- Create: `cloud/functions/wechat-audit-callback/__tests__/index.test.ts`

- [ ] **Step 1: Write failing function tests** for valid/invalid GET verification; valid POST pass; invalid signature; malformed body; unsupported event; unknown trace; and database failure returning a retryable status.
- [ ] **Step 2: Run** `npm.cmd --workspace cloud test -- --runInBand cloud/functions/wechat-audit-callback/__tests__/index.test.ts` and verify failure because the function is missing.
- [ ] **Step 3: Implement the HTTP adapter** using `WX_MESSAGE_TOKEN` and `WX_APPID`. Return plain text for GET, JSON for POST, 403 for trust failures, 400 for malformed events, 200 for acknowledged no-ops, and 500 for retryable persistence failures. Log only event class, match count, and status.
- [ ] **Step 4: Run focused tests** and `npm.cmd --workspace cloud run build`; verify `cloud/dist/wechat-audit-callback` is produced.
- [ ] **Step 5: Commit** with `git commit -m "feat(audit): add WeChat callback function"`.

### Task 4: Release registration and secret-safe configuration

**Files:**
- Modify: `scripts/lib/release-component-registry.mjs`
- Modify: `scripts/lib/release-component-registry.test.mjs`
- Modify: `scripts/cloud-release-smoke.mjs`
- Modify: `scripts/lib/cloud-release-smoke.test.mjs`
- Modify: `scripts/update-admin-env.mjs`
- Create or modify: `scripts/lib/update-admin-env.test.mjs`

- [ ] **Step 1: Write failing policy tests** requiring `wechat-audit-callback` in the cloud registry/smoke list and requiring secret redaction plus `post` propagation of `WX_APPID/WX_APPSECRET`.
- [ ] **Step 2: Run** `node --test scripts/lib/release-component-registry.test.mjs scripts/lib/cloud-release-smoke.test.mjs scripts/lib/update-admin-env.test.mjs` and verify the new assertions fail.
- [ ] **Step 3: Implement minimal registration/configuration changes**. Preserve existing environment variables, never print secret values, and make missing `WX_MESSAGE_TOKEN` fail closed for callback configuration.
- [ ] **Step 4: Re-run the focused Node tests** and `npm.cmd run test:governance` if the focused suites pass.
- [ ] **Step 5: Commit** with `git commit -m "build(audit): register callback release component"`.

### Task 5: User message and operational documentation

**Files:**
- Modify: `miniprogram/src/pages/create/index.vue`
- Create: `miniprogram/src/utils/__tests__/create-audit-copy.test.ts`
- Modify: `docs/release-gate.md`
- Create: `docs/changes/wechat-media-audit-callback.md`

- [ ] **Step 1: Add a failing static assertion** that pending media copy says it will automatically publish after passing.
- [ ] **Step 2: Run the focused mini-program test** and verify the copy assertion fails if the existing wording is insufficient.
- [ ] **Step 3: Apply the smallest copy change** and document exact WeChat console settings: dedicated HTTPS URL, JSON, plaintext, matching token, AppID, and callback verification evidence. Document rollback and old-pending-post handling.
- [ ] **Step 4: Run focused mini-program tests and `npm.cmd run docs:check`**.
- [ ] **Step 5: Commit** with `git commit -m "docs(audit): document automatic media review"`.

### Task 6: Full verification and PR delivery

**Files:**
- No new production files unless verification exposes a defect; any defect starts with a failing regression test.

- [ ] **Step 1: Run** focused callback/content-audit/function tests, `npm.cmd --workspace cloud run build`, `npm.cmd run test:governance`, relevant mini-program static tests, and `npm.cmd run docs:check`.
- [ ] **Step 2: Run `git diff --check`, self-review the complete diff, and verify** cwd, branch, HEAD, clean state, and AngryBird author identity.
- [ ] **Step 3: Push** `codex/wechat-media-audit-callback`, open a PR containing scope, tests, deployment/configuration requirements, data behavior, acceptance, and risks.
- [ ] **Step 4: Monitor exact-head PR checks/reviews/comments**, fix only with regression tests, arm Merge Queue using `gh pr merge <N> --auto --merge`, and continue until `MERGED` or `CLOSED`.
- [ ] **Step 5: From canonical synchronized public main, run the formal release flow** required by `docs/release-gate.md`, configure the WeChat message-push URL/token, and verify the deployed callback without exposing secrets.
- [ ] **Step 6: Acquire the validation lease and execute a real isolated image-post loop**: create through the mini program, observe text pass and image pending, observe callback transition to pass and member visibility, delete the fixture, and verify database cleanup. Do not claim production verification unless every stage has evidence.
