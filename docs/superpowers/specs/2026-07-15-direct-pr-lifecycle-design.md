# Direct PR lifecycle design

## Goal

Make the feature session that creates a PR own it through exact-head CI, Merge Queue, and terminal `MERGED` or `CLOSED`, without depending on webhook delivery or a centralized watchdog.

## Design

GitHub PR state is authoritative. After each ordinary push, the feature session verifies repository, head branch, and exact SHA directly from GitHub. It then follows checks, reviews, comments, conflicts, and `merge_group` results for that SHA. Once merge-ready, the same session runs `gh pr merge <N> --auto --merge` and stays responsible through the terminal state.

PR-control may retain ownership records, push caps, and command safety checks. Its webhook and `record-push` data are optional observability; missing delivery, paused mode, or delayed registration cannot block GitHub-backed PR progress. There is no centralized polling task or orphan watchdog. Formal release remains a separate canonical-main responsibility after merge.

## Failure handling

- A GitHub HEAD mismatch is a hard stop.
- A new push invalidates all earlier CI and review evidence.
- Deterministic CI, conflict, or review failures are fixed only in the original worktree.
- Transient queue failure with unchanged exact HEAD may be re-armed without a new commit.
- A stopped feature session is resumed explicitly from its original task and worktree; no background agent takes ownership.

## Acceptance

Repository policy and the shared skill both state the same authority, lifecycle, Merge Queue, webhook, and no-watchdog rules. A regression test prevents the repository policy from reverting to webhook-gated behavior.
