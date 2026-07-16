# PR Terminal Worktree Retirement Design

> **Historical / point-in-time:** This specification records the design adopted on 2026-07-16.
> **Current authority:** Use [AGENTS.md](../../../AGENTS.md), [SETUP.md](../../SETUP.md), and current worktree tooling and tests.

## Objective

Stop completed feature worktrees from consuming tens of gigabytes while preserving every existing Git and PR safety boundary.

## Design

The feature task that creates a PR owns the whole lifecycle: push, exact-HEAD CI, review, Merge Queue, terminal GitHub state, and retirement of its own worktree. After GitHub reports `MERGED`, the same task records its absolute worktree path, verifies the worktree is clean, then invokes the existing guarded retirement command from `C:\Project\Claude\happyHome_public`:

```powershell
npm.cmd run worktree:retire -- <absolute-feature-worktree-path>
```

The command remains the only deletion implementation. It refreshes main/open-PR evidence, requires the feature HEAD to be present in pinned main, rechecks clean/no-operation/non-reparse/common-Git boundaries immediately before non-force removal, and preserves the local feature branch. No watchdog, background scanner, broad directory deletion, or automatic cleanup of another task's worktree is introduced.

If a PR is `CLOSED` without merge and still has unique commits, retirement remains blocked. The feature task reports the exact blocker instead of deleting the only working copy. Dirty worktrees, active Git operations, open PRs, unknown remote evidence, and shared-operation locks also remain hard blockers.

## Discoverability

`AGENTS.md` makes retirement a mandatory terminal step, so every new repository task receives it automatically. `docs/SETUP.md` provides the exact cross-worktree command. The local `pr-feedback-loop` skill mirrors the rule for existing and future PR tasks. A repository policy test prevents the terminal-retirement contract from disappearing silently.

## Acceptance

- A feature task does not report a merged PR as fully finished until its own eligible worktree is retired.
- Successful retirement removes the worktree directory but preserves the local branch.
- A blocked retirement reports the exact reason and never falls back to force removal.
- No task scans or removes worktrees it did not create.

