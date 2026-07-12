# Shared UI Validation Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one machine-local, command-lifetime lease that serializes HappyHome DevTools automation and fixture-write operations across worktrees.

**Architecture:** A small lease library atomically creates `~/.happyhome/validation-lease.json`, renews a heartbeat, and releases only with the matching owner token. Guarded command entrypoints call the same wrapper; a tiny CLI provides status and explicit stale recovery.

**Tech Stack:** Node.js ESM, `node:test`, existing PowerShell/npm workflows

---

### Task 1: Lease state machine

**Files:**
- Create: `scripts/lib/validation-lease.mjs`
- Create: `scripts/lib/validation-lease.test.mjs`

- [ ] Write failing tests for atomic double-acquire, owner-token release, heartbeat refresh, stale-but-blocking inspection, corrupt-file fail-closed behavior, and explicit token-bound recovery.

Use the public API contract:

```js
const lease = acquireValidationLease({ command: 'test', homeDir, now })
lease.heartbeat()
lease.release()

inspectValidationLease({ homeDir, now })
recoverValidationLease({ homeDir, expectedOwnerToken, confirmNoOwner: true, reason: 'owner process absent' })
await withValidationLease({ command: 'test', homeDir }, async () => runValidation())
```

- [ ] Run `node --test scripts/lib/validation-lease.test.mjs` and confirm RED because the module is missing.
- [ ] Implement the minimal lease API: `acquireValidationLease`, `inspectValidationLease`, `recoverValidationLease`, and `withValidationLease`.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Guard shared entrypoints

**Files:**
- Create: `scripts/validation-lease.mjs`
- Modify: `scripts/test-mp.mjs`
- Modify: `scripts/test-mp-replay.mjs`
- Modify: `scripts/check-devtools-automation.mjs`
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `scripts/env-run.mjs`
- Modify: `package.json`

- [ ] Add CLI tests for `status` and explicit `recover` argument validation before implementing the CLI.

The supported CLI is limited to:

```powershell
node scripts/validation-lease.mjs status
node scripts/validation-lease.mjs recover --expected-owner-token=<uuid> --confirm-no-owner --reason="owner process absent"
```

- [ ] Wrap each DevTools entrypoint's top-level execution with `withValidationLease`.

Use the same top-level pattern in each script:

```js
await withValidationLease({ command: 'test:mp' }, main)
```

- [ ] Wrap only the `fixture-write` branch of `env-run.mjs`; keep `read` unguarded.
- [ ] Add `validation:lease:status` and `validation:lease:recover` package scripts.
- [ ] Verify two guarded commands cannot overlap using an isolated temporary HOME.

### Task 3: Document and verify

**Files:**
- Modify: `AGENTS.md`
- Test: `scripts/lib/validation-lease.test.mjs`

- [ ] Document the combined lease, guarded entrypoints, no-auto-takeover rule, and raw-command bypass boundary.
- [ ] Run focused lease tests, `npm.cmd run test:governance`, `git diff --check`, and the relevant static checks.
- [ ] Confirm the real user HOME has no lease file before reporting the shared lane available.
