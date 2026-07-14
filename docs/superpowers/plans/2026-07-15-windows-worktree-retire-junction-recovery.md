# Windows Worktree Retirement Junction Recovery Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-15 implementation sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [worktree setup and lifecycle guide](../../SETUP.md), current worktree code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `worktree:retire` safely complete Windows worktree removal when npm workspace junctions or a locked empty directory cause Git to return a partial-success error.

**Architecture:** Add filesystem-removal postcondition logic to the focused worktree lifecycle module and keep the CLI responsible for wiring real Git and filesystem operations. Preserve all existing retirement gates and non-force removal behavior.

**Tech Stack:** Node.js 24, npm 11, `node:test`, Git for Windows, NTFS junctions.

---

### Task 1: Specify retirement filesystem outcomes

**Files:**
- Modify: `scripts/lib/worktree-lifecycle.test.mjs`
- Modify: `scripts/lib/worktree-lifecycle.mjs`

- [ ] **Step 1: Write failing unit tests**

Add tests that call a wished-for `finalizeWorktreeRemoval` API and assert these exact outcomes: Git success returns `retired`; Git failure plus `registered=true` throws; Git failure plus successful residual removal returns `retired`; Git failure plus `empty=true` and an `EBUSY` removal error returns `retired_with_locked_empty_shell`; non-empty residue throws.

- [ ] **Step 2: Verify RED**

Run `node --test scripts/lib/worktree-lifecycle.test.mjs` and confirm failure because `finalizeWorktreeRemoval` is not exported.

- [ ] **Step 3: Implement the minimal classifier**

Export `finalizeWorktreeRemoval({ gitResult, registered, removeResidual, inspectResidual })`. Return only the two approved success statuses and throw for registered or non-empty ambiguous states.

- [ ] **Step 4: Verify GREEN**

Run `node --test scripts/lib/worktree-lifecycle.test.mjs` and require zero failures.

### Task 2: Integrate safe installation cleanup and recovery

**Files:**
- Modify: `scripts/worktree.mjs`
- Modify: `scripts/lib/worktree-flow-convergence.test.mjs`

- [ ] **Step 1: Write a failing CLI/integration test**

Create a linked worktree fixture containing root `node_modules` and a Windows junction when `process.platform === 'win32'`. Assert that retirement uses non-force Git removal, preserves the branch, and returns either `retired` or `retired_with_locked_empty_shell` without non-empty residue.

- [ ] **Step 2: Verify RED**

Run `node --test scripts/lib/worktree-flow-convergence.test.mjs` and confirm the fixture reproduces the current removal failure.

- [ ] **Step 3: Wire the minimal implementation**

Before Git removal, delete only `<target>/node_modules` through Node filesystem APIs. Invoke Git with `allowFailure: true`, check live registration after failure, and delegate postcondition classification to `finalizeWorktreeRemoval`. Include the resulting status in CLI JSON output.

- [ ] **Step 4: Verify GREEN**

Run `node --test scripts/lib/worktree-flow-convergence.test.mjs scripts/lib/worktree-lifecycle.test.mjs` and require zero failures.

### Task 3: Regression and policy verification

**Files:**
- Verify: `scripts/worktree.mjs`
- Verify: `scripts/lib/worktree-lifecycle.mjs`
- Verify: `scripts/lib/worktree-lifecycle.test.mjs`
- Verify: `scripts/lib/worktree-flow-convergence.test.mjs`

- [ ] **Step 1: Run focused tests**

Run `node --test scripts/lib/worktree-lifecycle.test.mjs scripts/lib/worktree-flow-convergence.test.mjs` and require zero failures.

- [ ] **Step 2: Run worktree policy tests**

Run `node --test scripts/lib/worktree-policy.test.mjs scripts/lib/worktree-environment.test.mjs` and require zero failures.

- [ ] **Step 3: Inspect the diff**

Run `git diff --check`, `git status --short`, and review the full diff. Confirm there is no `--force`, branch deletion, pruning, process termination, or unrelated dependency change.

- [ ] **Step 4: Commit and publish**

Commit as `AngryBird <48046333+angrybirddd@users.noreply.github.com>`, push `codex/windows-retire-junction-recovery`, create a ready PR with exact test evidence, and follow the repository PR feedback loop through Merge Queue to terminal state.
