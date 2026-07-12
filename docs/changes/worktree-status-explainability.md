# Worktree status explainability

> **Historical / point-in-time:** This fragment records one feature-branch delivery and does not represent current branch or merge status.
> **Current authority:** Use [AGENTS.md](../../AGENTS.md), the [setup guide](../SETUP.md), current worktree tooling, and tests.

## Change

`worktree:status` now reports explicit retirement evidence without performing cleanup. It fetches the remote through an explicit refspec so local `origin/main` metadata matches the remote main even after a forced rewind. It distinguishes `eligible`, `candidate_stale`, `blocked`, and `unprobeable`; preserves open-PR and other critical checks as unknown when their source cannot be verified; and keeps local inventory visible when refreshing `origin/main` fails.

`candidate_stale` is not permission to remove a worktree. It is limited to entries whose only blocker is `unknown_owner`; all other gates must be known and passing. Actual retirement continues to require the manifest-gated prepare/apply flow with a live recheck under the shared lease lock. No automatic retirement, bulk prune, or background cleanup is introduced.
