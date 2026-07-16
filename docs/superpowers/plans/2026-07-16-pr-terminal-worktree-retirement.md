# PR Terminal Worktree Retirement Implementation Plan

> **Historical / point-in-time:** This plan records the 2026-07-16 implementation sequence. Do not execute it after delivery is complete.
> **Current authority:** Use [AGENTS.md](../../../AGENTS.md), [SETUP.md](../../SETUP.md), current worktree tooling, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make safe self-retirement the mandatory final step of every HappyHome feature PR task.

**Architecture:** Reuse the existing guarded `worktree:retire` command without adding a deletion engine or background service. Put the lifecycle requirement in repository authority, mirror it in setup and the PR skill, and protect it with a static policy test.

**Tech Stack:** Markdown policy, Node.js built-in test runner, existing HappyHome worktree lifecycle CLI.

---

### Task 1: Repository lifecycle contract

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/SETUP.md`

- [ ] Add a terminal PR rule requiring the originating task to retire only its own eligible worktree after `MERGED`.
- [ ] Document the exact command run from canonical main and the branch-preservation/blocker behavior.

### Task 2: Regression contract

**Files:**
- Modify: `scripts/lib/worktree-policy.test.mjs`

- [ ] Add a test that reads `AGENTS.md` and `docs/SETUP.md`.
- [ ] Assert both documents contain the canonical main path, `worktree:retire`, terminal `MERGED`, and no-force/branch-preservation boundary.
- [ ] Run `node --test scripts/lib/worktree-policy.test.mjs` and expect all tests to pass.

### Task 3: Documentation and delivery

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-pr-terminal-worktree-retirement-design.md`
- Create: `docs/superpowers/plans/2026-07-16-pr-terminal-worktree-retirement.md`

- [ ] Run `npm.cmd run docs:check` and `git diff --check`.
- [ ] Commit and push as AngryBird, create the PR, wait for exact-HEAD CI, enter Merge Queue, and monitor to `MERGED`.
- [ ] Update the local `pr-feedback-loop` skill with the same terminal step.
- [ ] From canonical main, retire this implementation worktree and any other worktree created by this task that is already eligible.
