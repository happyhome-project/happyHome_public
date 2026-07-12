# Shared UI Validation Lease Design

## Goal

Serialize HappyHome operations that use the machine-wide WeChat DevTools state or the shared `fixture-write` lane, while keeping validation ownership and evidence in the current task.

## Minimal model

- Use one combined machine-local lease at `~/.happyhome/validation-lease.json`.
- Acquire it atomically before a guarded command starts and release it after that command finishes.
- Record an owner token, command, worktree path, process ID, acquired time, and heartbeat time.
- Refresh the heartbeat every 30 seconds during the guarded command.
- Never auto-take over an existing lease. An old heartbeat is reported as stale but remains blocking.
- Recovery requires the exact observed owner token, `--confirm-no-owner`, and a written reason; recovery archives the old lease instead of silently deleting it.

## Guarded entrypoints

The first version guards only normal collaborative entrypoints that touch the shared lane:

- WeChat DevTools UI automation: `test-mp.mjs`, `test-mp-replay.mjs`, `check-devtools-automation.mjs`, and `test-mp-release-ui.mjs`.
- `env-run.mjs` only when the selected profile is `fixture-write`.

Local builds, type-checks, unit tests, read-only cloud checks, and ordinary H5 preview do not acquire the lease.

## Failure behavior

- A second command fails closed and prints the current owner metadata.
- A corrupt lease fails closed.
- A crashed process leaves the lease behind; another task must inspect and explicitly recover it.
- Normal test failures still release the lease after the guarded command's existing cleanup runs.
- Fixture creation and deletion remain owned by the existing validation script; this lease serializes access and does not duplicate fixture lifecycle logic.

## Collaboration contract

- `AGENTS.md` tells every worktree to use guarded repository commands rather than raw DevTools or fixture-write calls.
- The lease is a coordination guard, not a security boundary; raw CLI/API calls can bypass it.
- The current task runs the guarded command and reads its screenshots, metrics, and cleanup evidence directly. No cross-task handoff is required.

## Out of scope

- Separate locks for DevTools and cloud fixtures.
- A remote lock service or one environment per worktree.
- Production deployment governance, release ledgers, database migrations, or credential management.
- Automatically terminating DevTools processes owned by another task.
