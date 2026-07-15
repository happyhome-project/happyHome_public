# Release Session Identity Implementation Plan

> **Historical / point-in-time:** This plan records the 2026-07-16 implementation sequence. Do not execute it after the delivery is complete.
> **Current authority:** Use the [formal release gate](../../release-gate.md), repository rules, current release code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and reuse one formal-release session identity, with safe local repair for human-readable labels and the latest-run pointer.

**Architecture:** Add one focused library for session schema, generation, validation and repair, plus one thin CLI that delegates prepare/publish to the existing release guard. No new deployment engine or production data model is introduced.

**Tech Stack:** Node.js 24 ESM, node:test, existing HappyHome release scripts and JSON ledgers.

---

### Task 1: Release session model

**Files:**
- Create: `scripts/lib/release-session-identity.mjs`
- Test: `scripts/lib/release-session-identity.test.mjs`

- [ ] Write failing tests proving generated UUID/full SHA, collision-safe readable IDs, immutable-field validation, pre-run version/description repair, post-run alias repair, and exact-ledger latest-pointer recovery.
- [ ] Run `node --test scripts/lib/release-session-identity.test.mjs` and confirm the missing module failure.
- [ ] Implement atomic session creation, schema validation and bounded repair without touching run ledgers or production state.
- [ ] Rerun the test and confirm all cases pass.

### Task 2: Thin release session CLI

**Files:**
- Create: `scripts/release-session.mjs`
- Test: `scripts/lib/release-session-cli.test.mjs`
- Modify: `package.json`

- [ ] Write failing CLI tests using injected Git/process runners to prove create emits one path, prepare/publish forward identical generated values, and repair never invokes deployment.
- [ ] Run `node --test scripts/lib/release-session-cli.test.mjs` and confirm failure.
- [ ] Implement `create`, `prepare`, `publish`, `status` and `repair`; delegate prepare/publish to `scripts/deploy.mjs` and preserve exit codes.
- [ ] Add `release:session` to `package.json` and rerun targeted tests.

### Task 3: Policy and operator documentation

**Files:**
- Modify: `docs/release-gate.md`
- Modify: `scripts/lib/release-policy.test.mjs`
- Modify: `X:/Users/86136/.codex/skills/happyhome-release/SKILL.md` after the repository PR merges

- [ ] Add a policy test requiring the package entrypoint and documenting that session labels cannot authorize artifact reuse.
- [ ] Update the release gate with the three-command session workflow and one-minute repair boundary.
- [ ] Run `node --test scripts/lib/release-session-identity.test.mjs scripts/lib/release-session-cli.test.mjs scripts/lib/release-policy.test.mjs`.
- [ ] Run `npm.cmd run test:deploy-output` and `git diff --check`.

### Task 4: Integration and real no-mutation acceptance

**Files:**
- No additional source files.

- [ ] Create a session against the exact feature-worktree HEAD using an injected/non-production test mode and verify generated values are internally consistent.
- [ ] Repair its labels before a run exists and verify no release ledger, lock, fixture or upload evidence is created.
- [ ] Commit with author `AngryBird <48046333+angrybirddd@users.noreply.github.com>`, push, create a PR, wait for exact-HEAD required CI, enter Merge Queue and monitor to `MERGED`.
- [ ] Fast-forward canonical main, update the local `happyhome-release` skill to recommend `release:session`, and run one formal current-main release through the new session entrypoint.
