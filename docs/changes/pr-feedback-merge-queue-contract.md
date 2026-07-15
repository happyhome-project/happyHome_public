# PR feedback and Merge Queue contract

> **Historical / point-in-time:** This fragment records one feature-branch delivery and does not represent current branch or merge status.
> **Current authority:** Use [AGENTS.md](../../AGENTS.md) and the [setup guide](../SETUP.md).

## Change

Feature worktrees own their PR lifecycle end to end: after every push they verify the authoritative GitHub exact HEAD, monitor that head's CI and review feedback, arm Merge Queue themselves when ready, and remain responsible until GitHub reports `MERGED` or `CLOSED`. Webhook delivery and PR-control `record-push` are optional observability signals, not progress gates; no centralized poller or orphan watchdog is required. Code-related queue failures return to the original worktree, while an unchanged exact head may be re-armed after a transient queue failure without manufacturing a commit. `merge_group` CI validates each current queue composition, and canonical main release work begins only after GitHub confirms the real merge.
