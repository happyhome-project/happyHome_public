# Shared H5 Test Tenant Design

> **Historical / point-in-time:** This specification records the design accepted for the 2026-07-13 delivery. It does not override later implementation, testing, or production-governance decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current `AGENTS.md`, the H5 preview runbook, validation scripts, and tests.

## Goal

Make homepage UI validation reliable for one person using Codex across multiple worktrees, without creating a second CloudBase environment or recreating a community for every task.

The first version solves the current homepage and tabs workflow only. It does not turn the H5 preview into a general production client.

## Decisions

- Keep one long-lived, hidden test community in the existing real CloudBase environment.
- Keep one low-privilege synthetic H5 viewer that belongs only to that community.
- Add the real WeChat validation identity as a second member of the same community.
- Treat the baseline as immutable during ordinary UI validation, so every worktree may read it concurrently without a validation lease.
- Reuse the existing `home-prefetch` and `backgroundFetchToken` path for H5 homepage data.
- Keep the token in machine-local configuration and proxy only the homepage snapshot through the local H5 development server. Do not place the token in source control, Vite client variables, browser logs, or screenshots.
- Keep the existing validation lease only for baseline creation or repair, token rotation, shared configuration changes, and WeChat DevTools automation.

## Test Community

The community has a stable fixture key and a visible administrative name such as `【系统测试】首页 UI 基线 v1`.

Its production document is:

- `status=active`
- `joinType=approval`
- `discoverable=false`
- marked with an internal, non-secret fixture key used by the provisioner and doctor
- excluded from any default or public-read community configuration

`discoverable` is optional and defaults to visible for existing communities. User-facing `community.list` and `community.listDiscoverable` omit communities where it is `false`. `member.myCommunities` remains membership-based, so the two approved test identities can still open the hidden community. The admin surface continues to show it for governance.

This is directory hiding, not a new authorization system. Existing membership checks continue to protect sections and posts, and the random community ID is not published through normal UI or sharing flows.

## Baseline Data

The versioned baseline manifest defines exactly three homepage sections:

1. A long archive with exactly 30 active posts, providing enough scroll runway for sticky-tabs validation.
2. A short archive with exactly one active post, covering long-to-short tab switching while the page is scrolled.
3. An empty archive with no active posts, covering the empty state.

Section order, section type, widget schema, post fixture keys, and expected counts are deterministic. Baseline posts finish in a non-actionable audit state so they do not pollute normal moderation queues.

Ordinary H5 startup never seeds or repairs data. A read-only doctor compares the real environment with the manifest and fails with an exact mismatch if the baseline is incomplete.

## H5 Data Path

The synthetic viewer has a normal `users` document and an active member record only for the test community. Its existing opaque `backgroundFetchToken` authorizes `home-prefetch`, which returns the same homepage snapshot shape already consumed by the mini-program home store.

Each worktree starts its own H5 server on an available localhost port. A development-only server middleware reads the token from `~/.happyhome/h5-test-tenant.env`, calls `home-prefetch`, and returns only the snapshot. The browser bundle never receives the token.

The H5 bootstrap applies that snapshot to the normal homepage store and selects the test community. It does not call `devLogin`, `http-gateway`, or inject `_testOpenid`.

## Provision and Doctor

Provisioning is explicit and idempotent:

1. `prepare` is read-only and reports the exact environment, fixture identity, current state, and proposed additions or repairs.
2. `apply` requires the prepared identity, the `fixture-write` validation lease, and the expected production environment ID.
3. It creates or reconciles only the fixed synthetic viewer, its single membership, the fixed community, and manifest-owned sections and posts.
4. It never deletes an unknown community, account, section, or post, and it never joins the viewer to another community.

The normal startup doctor is read-only and checks:

- exact CloudBase environment and fixture key
- hidden, active community state
- synthetic viewer membership and absence of real-community memberships
- token presence and expiry, warning before the renewal window
- section schema, order, and expected 30/1/0 post counts
- successful `home-prefetch` response and snapshot shape

A doctor failure stops H5 validation with a specific cause. It never waits indefinitely and never repairs production automatically.

## Concurrency and Lease Boundary

Concurrent reads of an immutable baseline are safe, so normal H5 homepage validation does not acquire the lease.

The validation lease remains mandatory for:

- initial provision, explicit reconcile, or token rotation
- changes to the shared community or section configuration
- tests that intentionally mutate the same shared records
- the single machine-wide WeChat DevTools instance

Future write tests may avoid a global lease only when their records are partitioned by a unique run ID, assertions use exact created IDs, and cleanup is independently verifiable. That capability is not implemented in this delivery.

## Failure and Security Boundaries

- Production `ALLOW_TEST_OPENID` remains disabled.
- The generic `http-gateway` remains disabled and is not expanded.
- The H5 viewer is not an admin and must not belong to a real community.
- The machine-local token is not committed or emitted in logs, screenshots, or evidence.
- Missing, expired, or rejected tokens fail closed.
- A missing or undersized dataset is a doctor failure, not a reason to create ad hoc data during a UI run.
- Baseline cleanup is never automatic. A future replacement version is provisioned explicitly before an old version is considered for retirement.

## Verification

Repository tests must cover:

- `discoverable=false` filtering for ordinary list and discovery calls
- continued member access through `member.myCommunities`
- provision prepare/apply scoping and idempotency with mocked cloud access
- doctor failures for missing token, wrong environment, membership drift, and insufficient post counts
- client code containing no gateway token or test-openid fallback in the H5 baseline path

After the change reaches the canonical main branch, one leased real-environment provision run establishes the baseline. Acceptance then uses:

1. Concurrent H5 reads from at least two worktrees without a lease.
2. Homepage geometry checks proving the long section provides scroll runway, the tabs reach their sticky position, search scrolls away, and switching to the short section remains stable.
3. A final leased WeChat DevTools or real-device check using the real WeChat member of the same community.

## Out of Scope

- A second QA CloudBase environment.
- Per-worktree communities or per-run community creation.
- CloudBase Web username/password authentication.
- A general H5 CRUD backend or signed identity broker.
- Re-enabling the production HTTP gateway or arbitrary OpenID injection.
- A global fixture registry, background janitor, or automatic destructive cleanup.
- Replacing the machine-local DevTools validation lease.
