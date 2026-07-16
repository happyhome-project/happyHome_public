# Collaboration Audit Timeout Implementation Plan

> **Historical / point-in-time:** This plan records the implementation sequence used on 2026-07-16. Retain it for traceability; do not execute it as current work.
> **Current authority:** Use the [documentation authority map](../../README.md), current code, tests, and GitHub PR state.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a stalled WeChat content-audit request from consuming the 15-second `createCollaboration` cloud-function budget and surfacing a false publish failure.

**Architecture:** Keep the existing synchronous submission and manual-review fallback, but place a four-second deadline on every WeChat OpenAPI HTTPS request. A timed-out request is destroyed with an explicit error; `content-audit` already catches that error and records a manual-review result, allowing the persisted post to return normally.

**Tech Stack:** TypeScript, Node.js `https`, Jest.

---

### Task 1: Bound WeChat OpenAPI latency

**Files:**
- Create: `cloud/lib/__tests__/wx-openapi.test.ts`
- Modify: `cloud/lib/wx-openapi.ts`

- [ ] **Step 1: Write the failing test**

Add a mocked `https.request` test which withholds a response, invokes the registered request timeout, and expects `postWxJson` to reject after destroying the request.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd --prefix cloud test -- --runInBand lib/__tests__/wx-openapi.test.ts`

Expected: FAIL because the request does not register a timeout.

- [ ] **Step 3: Write minimal implementation**

Set a four-second timeout on the request. On timeout, destroy it with `WeChat OpenAPI request timed out after 4000ms` so the existing audit fallback can convert the external failure into manual review.

- [ ] **Step 4: Run focused and related tests**

Run the focused test, `content-audit.test.ts`, the post function tests, and the cloud build.

- [ ] **Step 5: Commit and publish the feature branch**

Commit with the configured `AngryBird` identity, push `codex/collaboration-audit-timeout`, open a PR, then follow exact-HEAD CI and Merge Queue to terminal state.
