# Public worktree retirement guard

> **Historical / point-in-time:** This fragment records one feature-branch delivery and does not represent current branch or merge status.
> **Current authority:** Use [AGENTS.md](../../AGENTS.md), the [setup guide](../SETUP.md), current worktree tooling, and tests.

## Change

Public worktree creation and retirement no longer identify their operator through a private canonical filesystem path. The operator is now derived from live Git evidence after an explicit `origin/main` refresh: exact public repository identity, attached `main`, a clean synchronized HEAD, no in-progress Git operation, and a non-reparse root.

Both mutation paths fail closed on identity drift. A verified public remote URL is captured before fetch, so later origin configuration drift cannot redirect it. Bounded, non-interactive network queries run before the shared lock and produce an exact target HEAD/main/PR snapshot; local Git mutations have no short timeout. Inside the lock, create rechecks the same root, real Git common directory, HEAD, and main SHA, then uses that immutable SHA for both `git worktree add` and verification. Retirement rejects reparse ancestors or a target whose real common directory differs from the operator, uses the captured HEAD and main SHA for identity, unique-commit, and ancestry evidence, and repeats the full local probe immediately before remove. The optional local-branch deletion flag is disabled, so branches are always retained. This guard does not alter the private production canonical boundary used by release, deployment, or PR integration tooling.
