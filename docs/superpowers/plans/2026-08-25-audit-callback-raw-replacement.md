# Audit Callback Raw Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified audit callback reconcile a Tencent CI task whose submission payload is stored as an XML string, without persisting callback credentials.

**Architecture:** Keep callback authentication and audit aggregation unchanged. Sanitize callback credentials before creating the durable callback record, and use the database adapter's atomic replacement command when copying the callback `raw` payload onto an audit task so CloudBase can transition the field from string to object.

**Tech Stack:** TypeScript, Jest, wx-server-sdk/CloudBase database commands.

**Spec:** `docs/superpowers/specs/2026-07-15-wechat-media-audit-callback-design.md`

## Global Constraints

- Never directly set a post or task to `pass`; only the existing verified callback and aggregation path may do so.
- Never persist `callbackToken` or `token` in audit callback diagnostic data.
- Preserve callback idempotency, revision matching, search, archive-topic, and RAG lifecycle behavior.
- Limit production changes to `cloud/lib/content-audit.ts` and its focused unit test.

---

### Task 1: Make callback task replacement type-safe and credential-safe

**Files:**
- Modify: `cloud/lib/content-audit.ts`
- Test: `cloud/lib/__tests__/content-audit.test.ts`

**Interfaces:**
- Consumes: `handleAuditCallback(params)` and `db.replaceValue(value)`.
- Produces: the existing callback result contract, with task `raw` atomically replaced by a sanitized payload.

- [ ] **Step 1: Write the failing regression test**

Add a test that starts with a pending Tencent CI task whose `raw` value is an XML string. Make the database double reproduce CloudBase's `PathNotViable` behavior when an object is merged into that string, call `handleAuditCallback` with a valid token and `Result: '0'`, and assert that the callback succeeds, the task becomes `pass`, and its final `raw` object excludes `callbackToken` and `token`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd --workspace cloud exec -- jest --config jest.config.js lib/__tests__/content-audit.test.ts --runInBand
```

Expected: FAIL with the synthetic `PathNotViable` error because `callbackPatch` currently merges the callback object into the stored XML string.

- [ ] **Step 3: Implement the minimal production fix**

In `cloud/lib/content-audit.ts`:

```ts
function callbackPatch(record: AuditCallbackRecord) {
  return {
    status: record.status,
    suggest: record.suggest,
    label: record.label,
    reason: record.reason,
    raw: db.replaceValue(record.raw),
    updatedAt: record.updatedAt,
  }
}

function sanitizeAuditCallbackRaw(params: any) {
  const raw = { ...(params || {}) }
  delete raw.callbackToken
  delete raw.token
  return raw
}
```

Pass `sanitizeAuditCallbackRaw(params)` to `persistAuditCallbackRecord` from `handleAuditCallback`.

- [ ] **Step 4: Run focused and full cloud tests**

Run:

```powershell
npm.cmd --workspace cloud exec -- jest --config jest.config.js lib/__tests__/content-audit.test.ts --runInBand
npm.cmd --workspace cloud run test:unit -- --runInBand
npm.cmd --workspace cloud run build
```

Expected: all commands exit `0`; the focused regression and existing callback/idempotency suites pass.

- [ ] **Step 5: Commit with the required Git identity**

```powershell
git add cloud/lib/content-audit.ts cloud/lib/__tests__/content-audit.test.ts docs/superpowers/plans/2026-08-25-audit-callback-raw-replacement.md
git commit -m "fix(cloud): replace audit callback payload atomically"
```

### Task 2: Integrate, release, and reconcile the blocked audio posts

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: repository PR/merge-queue workflow, HappyHome guarded release session, existing `audit.callback` action.
- Produces: deployed callback fix and provider-backed audit transitions for the three requested native audio posts.

- [ ] **Step 1: Push the feature branch and integrate it through PR CI and GitHub Merge Queue**

Use the repository-owned integration script; do not push directly to `main`.

- [ ] **Step 2: Refresh the canonical public `main` and run the guarded release workflow**

Run `release:session create --full-current`, `prepare`, and `publish` from a clean synchronized `C:\Project\Claude\happyHome_public` checkout. Stop before publish if any hard gate fails.

- [ ] **Step 3: Re-query every Tencent CI audio job before callback reconciliation**

Require HTTP `200`, matching `JobId`, `State=Success`, `Result=0`, and `Label=Normal`. Submit those exact results through `audit.callback`; never call the manual approval action.

- [ ] **Step 4: Complete the requested production data migration**

Create and verify `文化苍生` and `普门颂` after `寒山钟声与西湖春` is active, passed, and member-visible. Only when all three native audio posts pass exact field/media checks, soft-delete the two explicitly approved old-format posts.

- [ ] **Step 5: Perform final closed-loop verification**

Verify the three target posts are active, native archive audio, authored by 明阳, tagged `德音雅乐`, audit-passed, member-visible, and backed by resolvable exact media references. Verify both approved legacy posts are soft-deleted and no duplicate active native targets exist.
