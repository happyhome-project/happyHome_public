# Worktree lifecycle governance

## Status

Implemented on the `codex/worktree-lifecycle-governance` feature branch; it is not merged until PR CI passes and the canonical main workspace integrates the PR.

## Change

- Pin worktree bootstrap/runtime checks to Node 24/npm 11 and use the root workspace lockfile only. Trusted CI workflow upgrades are intentionally excluded from this feature PR and require a separate CI-governance change.
- Add explicit doctor, bootstrap, status, sync-main, retire, environment-profile, docs-check, and docs-catalog commands.
- Record Codex/Claude session heartbeats in the common Git directory under a shared lock; a hook must first be trusted by its client. Missing or stale (over 12 hours) heartbeats remain `unknown`, not inactive, and are retirement blockers.
- Keep main integration PR-only; no background merge, rebase, stash, or remote branch deletion is introduced.
- `env:run` classifies local commands only. Actual deployment commands enforce canonical `main`, clean state, and `HEAD=origin/main` at runtime.

## Operational impact

Existing worktrees remain lazily migrated. `worktree:retire` has no auto-delete path: it requires a prepare manifest, a live recheck, and uses non-force Git removal. The current 46-document corpus still needs a separate semantic reconciliation; this change only establishes canonical entry points, change fragments, and link checking. Production actions remain blocked outside the canonical main workspace.

If a hook process is interrupted while holding the common-Git `happyhome-worktrees/leases.lock`, heartbeats fail closed and retirement remains blocked. A canonical-main operator must first use `worktree:status` and independently confirm there is no active session before repairing that lock; the tool deliberately never deletes another process's lock automatically.
