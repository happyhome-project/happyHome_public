# Windows Worktree Retirement Junction Recovery Design

## Problem

On Windows, `npm ci` for this npm-workspace repository creates junctions inside the root `node_modules`. `git worktree remove <path>` can unregister an eligible worktree and delete part of its contents, then return a non-zero status such as `Directory not empty` or `Permission denied`. The current retirement command treats that partial success as a generic failure and leaves installation artifacts behind.

## Scope

Keep every existing retirement gate and the non-force Git removal contract. Fix only the filesystem-removal phase. Do not change npm workspaces, branch deletion, PR policy, synchronization, deployment, or release behavior.

## Design

Before calling Git, remove the target worktree's root `node_modules` installation tree with Node filesystem APIs. The target boundary has already been pinned and revalidated; removal remains confined to that target. A reparse-point `node_modules` entry is unlinked rather than followed.

Run `git worktree remove <path>` without `--force`. If Git succeeds, report `retired`. If Git fails, determine the postcondition instead of assuming no mutation occurred:

- If the path remains registered as a worktree, propagate a hard failure.
- If Git has unregistered it, remove any residual target contents.
- If the target disappears, report `retired`.
- If only an empty directory remains because Windows reports `EBUSY`, `EPERM`, or `EACCES`, report `retired_with_locked_empty_shell` as a successful retirement with a warning.
- If any non-empty residue remains, fail closed and preserve the residue for inspection.

The local feature branch is never deleted. No `--force`, stash, reset, rebase, prune, process termination, or external-path cleanup is introduced.

## Testing

Add focused tests for pre-removal installation cleanup and post-removal classification. Tests must prove that a Git failure is accepted only after registration is gone, that a locked empty shell produces the approved success status, and that registered or non-empty residual states remain hard failures. Keep the existing integration assertion that the branch survives retirement and the Git arguments contain no `--force`.

## Success Criteria

`worktree:retire` handles the observed Windows npm-workspace junction case without leaving dependency contents, accurately distinguishes full removal from a locked empty shell, and fails closed for every ambiguous or unsafe state.
