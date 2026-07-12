# Full-Current Public Release Design

> **Historical / point-in-time:** This specification records the full-current release design accepted on 2026-07-12. It does not override later implementation or operational policy.
> **Current authority:** Use the [formal release gate](../../release-gate.md), repository rules, current release code, and tests.

## Goal

Add an explicit `full-current` formal release mode that publishes the exact current `main` commit from `C:\Project\Claude\happyHome_public`. This mode deliberately does not use the previous production Git SHA to calculate a diff. It does not delete, rewrite, or fabricate production release state.

## Scope

`full-current` is a one-release planning strategy, not a new deployment path. It reuses the existing formal release guard, ledger, build, evidence, deployment, upload, smoke, cleanup, and completion machinery.

When explicitly selected, the generated plan must:

- bind to the current exact `HEAD` SHA;
- deploy every checked-in CloudBase function;
- build and deploy `admin-web`;
- build, validate, and upload the mini-program;
- validate every checked-in `release/changes` manifest and run its allowlisted idempotent actions;
- run unapplied declared migrations through the existing migration tracking;
- record `full-current` as the plan strategy and record no historical diff base.

The mode does not import private Git objects, map a legacy SHA, clear production state, or treat a missing Git object as an implicit bootstrap.

## Explicit Invocation And Binding

The planner gains `--mode=full-current`. Normal `--mode=main` keeps its current production-state diff behavior unchanged.

Formal prepare and publish commands must also receive an explicit `--full-current` flag. Prepare records the release strategy, exact Git SHA, run ID, version, description, and mini-program package evidence in the ledger. Publish must use the same run ID and flag, and must reject a ledger whose strategy or exact SHA differs. A normal publish command must never infer `full-current` from a missing or unreadable production base.

The generated plan uses these unambiguous values:

- `mode: "full-current"`
- `baseSha: null`
- `planningStrategy: "full-current"`
- `releaseRequired: true`
- Cloud target mode `all`, containing the complete checked-in function allowlist
- `adminWeb: true`
- `miniprogram: true`

## Authorization Gates

Both planning and every remote mutation must fail closed unless all of the following are true:

- the repository root is exactly `C:\Project\Claude\happyHome_public`;
- `origin` identifies `happyhome-project/happyHome_public`;
- the current branch is attached `main`;
- the worktree is clean, except for the existing narrowly allowed prepared build-info change during publish resume;
- a fresh fetch proves `HEAD == origin/main`;
- the plan, ledger, prepared artifacts, and publish command all bind to the same exact SHA;
- the caller explicitly selected `full-current`;
- the production release lock is acquired and its heartbeat remains healthy.

Feature branches, other worktrees, detached HEADs, dirty worktrees, stale `main`, a different remote, strategy mismatch, SHA drift, or omission of the explicit flag are rejected before production mutation.

## Release Flow

1. Audit the public canonical checkout and refresh `origin/main`.
2. Prepare the release with an explicit `--full-current`, producing the ledger entry, mini-program build, package digest, and required DevTools UI evidence.
3. Resume publish with the same run ID and `--full-current`.
4. Revalidate canonical identity and exact SHA, generate the forced full-current plan, ensure the release control plane, and acquire the production lock.
5. Validate all checked-in release manifests. Execute only allowlisted actions and tracked migrations; action implementations remain responsible for idempotency.
6. Deploy all CloudBase functions, verify per-function release probes, and run the existing cloud invoke, log, fixture, and cleanup smoke gates.
7. Deploy `admin-web`.
8. Verify that the prepared mini-program digest is unchanged, upload it, and verify build-info and upload evidence.
9. Complete through the existing guarded remote confirmation, then mark the local ledger passed.

The mandatory UI labels remain `HH_RELEASE_HOME_DETAIL_NONEMPTY` and `HH_RELEASE_LOGIN_VERSION`. The mandatory cloud evidence and `HH_CLOUD_FIXTURE_CLEANUP_OK` remain unchanged.

## State And Failure Semantics

Production state advances to the released public exact SHA only through the existing successful guarded completion. A failure at any earlier stage records the failed run and releases or expires the lock through existing guard behavior, but must not advance the production `gitSha` or `lastSuccessfulRunId`.

After a successful full-current release, later normal releases use `--mode=main` and diff from the public SHA now stored in production state. `full-current` remains available only as an explicit operator choice; it never becomes the default recovery path.

## Verification

Automated tests must prove:

- `full-current` never reads the previous production SHA as a Git diff base;
- it always selects all cloud functions, admin web, mini-program, and all valid declared release operations;
- normal `main` planning retains its existing incremental behavior;
- prepare/publish strategy, run ID, and SHA binding cannot be mixed or omitted;
- private canonical paths, feature branches, dirty or stale public `main`, wrong remotes, and non-explicit invocation are rejected before mutation;
- a failed stage cannot advance successful production state;
- successful remote confirmation advances production state to the exact public SHA and leaves auditable plan, ledger, UI, cloud smoke, cleanup, deploy, and upload evidence.

Repository documentation and the local HappyHome release skill must name the public canonical path and show the explicit prepare/publish command shape. No test may weaken the existing release lock, UI evidence, cloud smoke, fixture cleanup, digest, or ledger requirements.
