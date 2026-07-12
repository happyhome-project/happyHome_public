# PR feedback and Merge Queue contract

> **Historical / point-in-time:** This fragment records one feature-branch delivery and does not represent current branch or merge status.
> **Current authority:** Use [AGENTS.md](../../AGENTS.md) and the [setup guide](../SETUP.md).

## Change

Feature worktrees now have an explicit PR feedback responsibility: synchronize once before opening a PR, monitor exact-head CI and review feedback, fix failures only in the original worktree, and remain responsible until the PR reaches a GitHub terminal state. The coordinator owns readiness revalidation and enqueue transitions. It routes code-related queue failures back to the original worktree, but may re-enqueue an unchanged exact head after a transient infrastructure or queue-state failure without manufacturing a commit. Multiple ready PRs may enter Merge Queue without repeatedly chasing an advancing main; `merge_group` CI validates each current queue composition. Public coordination reports a merge only after GitHub confirms the real merged state and successful queue validation, then fast-forwards public main without invoking private integration, release, or deployment paths.
