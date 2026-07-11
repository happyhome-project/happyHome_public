# Worktree lifecycle governance

> **Historical / point-in-time:** This fragment records one feature-branch delivery and does not represent current branch or merge status.
> **Current authority:** Use [AGENTS.md](../../AGENTS.md), the [documentation authority map](../README.md), current worktree tooling, and tests.

## Status

Implemented on the `codex/worktree-lifecycle-governance` feature branch; it is not merged until PR CI passes and the canonical main workspace integrates the PR.

## Change

- Pin worktree bootstrap/runtime checks to Node 24/npm 11 and use the root workspace lockfile only. The trusted CI workflow and Merge Queue support are inherited unchanged from public `main`; this feature does not modify either workflow.
- Add explicit doctor, bootstrap, status, sync-main, retire, environment-profile, docs-check, and docs-catalog commands.
- Record Codex/Claude session heartbeats in the common Git directory under a shared lock; a hook must first be trusted by its client. Missing or stale (over 12 hours) heartbeats remain `unknown`, not inactive, and are retirement blockers.
- Keep main integration PR-only through the repository Ruleset and Merge Queue; no background merge, rebase, stash, or remote branch deletion is introduced.
- `env:run` classifies local commands only. Actual deployment commands enforce canonical `main`, clean state, and `HEAD=origin/main` at runtime.

## Operational impact

Existing worktrees remain lazily migrated. `worktree:sync-main` fails closed when ownership is unknown unless the operator explicitly supplies `--confirm-no-owner`; an active lease cannot be overridden. `worktree:retire` has no auto-delete path: it requires a schema-versioned, expiring prepare manifest bound to a digest record in the common Git directory. Apply rechecks the record, owner, and live Git identity while holding the shared lease lock through non-force Git removal. The current document corpus still needs a separate semantic reconciliation; this change only establishes canonical entry points, change fragments, and repository-confined link checking. Production actions remain blocked outside the canonical main workspace, and direct deployment paths revalidate the clean synchronized main state immediately before each remote mutation, including each CloudBase transient retry.

If a hook process is interrupted while holding the common-Git `happyhome-worktrees/leases.lock`, heartbeats fail closed and retirement remains blocked. A canonical-main operator must first use `worktree:status` and independently confirm there is no active session before repairing that lock; the tool deliberately never deletes another process's lock automatically.
