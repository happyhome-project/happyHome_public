# Shared Web H5 Test Tenant Design

> **Historical / point-in-time:** This specification records the design accepted for the 2026-07-13 delivery. It does not override later implementation, testing, or production-governance decisions.
> **Current authority:** Use the [documentation authority map](../../README.md), current `AGENTS.md`, the H5 preview runbook, validation scripts, and tests.

## Goal

Give the existing uni-app H5 build a stable, general connection to the same CloudBase backend used by the mini-program, then validate it through one long-lived hidden test community shared by multiple Codex worktrees.

This removes repeated community creation and fake OpenID login without creating a second environment or a second business backend.

## Scope Boundary

The first delivery includes the reusable platform pieces needed by existing H5 pages:

- CloudBase Web authentication with one dedicated low-privilege account
- generic CloudBase Web SDK cloud-function calls
- the storage operations already used by profile, post creation, and audio rendering
- H5 login, logout, session recovery, and explicit unsupported-state handling for WeChat-only capabilities
- one hidden, versioned real-environment test community and a read-only baseline doctor

It does not redesign existing pages, add new business features, recreate WeChat-only APIs in the browser, or introduce a custom backend service.

## Identity Model

The test community has two independent active members:

1. A dedicated CloudBase Web account used by H5.
2. The current real WeChat validation identity used by DevTools and real-device checks.

The Web account is created through CloudBase end-user management, uses username/password authentication, has no admin role, and belongs only to the test community. Automated tests read its credentials from `~/.happyhome/h5-web.env`; credentials are never compiled into the client or committed.

Cloud functions resolve a caller through one shared rule:

- mini-program calls use the trusted WeChat `OPENID`
- authenticated Web SDK calls use the trusted CloudBase `TCB_UUID`
- Web identities are stored as `web:<TCB_UUID>` to prevent collisions with WeChat OpenIDs
- anonymous or missing Web identity is rejected
- `_testOpenid` remains disabled in production

The client cannot submit or override either identity value.

## Web Runtime Adapter

The H5 build initializes one CloudBase Web SDK application using the public environment ID and publishable client configuration. It uses one authentication API generation consistently; v1 and v2/v3 session APIs are never mixed.

The existing client API boundary remains `callCloud(name, action, params)`:

- mini-program runtime continues to use `wx.cloud.callFunction`
- H5 runtime uses the authenticated Web SDK `app.callFunction`
- both paths use the same result normalization and business error handling
- the production HTTP gateway and `x-test-openid` path are removed from normal H5 execution

A focused storage adapter provides the operations already required by the current UI:

- upload a browser-selected file to a generated cloud path
- resolve temporary URLs for cloud file IDs
- return normalized progress and error shapes to existing pages

WeChat-only capabilities such as subscription messages, background fetch registration, native share behavior, and APIs without a browser equivalent remain platform-gated. H5 displays an explicit unavailable message instead of hanging or pretending success.

## H5 Session Flow

The profile page exposes a normal H5 account login form instead of the fake OpenID DEV login. On successful CloudBase authentication it calls the existing `user.login` business action to load or create the application profile, then loads memberships through the same cloud functions as the mini-program.

Startup checks the Web SDK login state before trusting the persisted Pinia user store:

- valid Web session: restore the business user and memberships
- expired or absent session: clear user and community state and show login
- login failure: preserve no partial authenticated state and show the concrete provider error
- logout: sign out of CloudBase first, then clear local user and community state

Multiple worktrees may log into the same low-privilege account concurrently. Ordinary reads and idempotent session refreshes do not use the validation lease.

## Test Community

The community has a stable internal fixture key and a visible administrative name such as `【系统测试】Web H5 基线 v1`.

Its production document is:

- `status=active`
- `joinType=approval`
- `discoverable=false`
- excluded from default and public-read community configuration

`discoverable` is optional and defaults to visible for existing communities. Ordinary `community.list` and `community.listDiscoverable` omit hidden communities. `member.myCommunities` remains membership-based, so the two approved test identities can open it. The admin surface continues to show it for governance.

This is directory hiding, not a new authorization layer. Existing membership checks continue to protect community content.

## Baseline Data

The versioned baseline manifest defines exactly three homepage sections:

1. A long archive with exactly 30 active posts.
2. A short archive with exactly one active post.
3. An empty archive with no active posts.

The long section supplies scroll runway, the short section covers switching while scrolled, and the empty section covers the empty state. Section order, widget schema, post fixture keys, and expected counts are deterministic. Baseline posts finish in a non-actionable audit state.

Ordinary H5 startup never seeds or repairs data. A read-only doctor reports exact drift.

## Provision and Doctor

Provisioning is explicit and idempotent:

1. `prepare` reads the exact environment and reports the proposed Web account, business user, memberships, community, sections, and posts.
2. `apply` requires the prepared identity, expected environment ID, and `fixture-write` validation lease.
3. It creates or reconciles only manifest-owned records.
4. It never deletes an unknown account, community, section, or post and never joins the Web account to a real community.

The read-only doctor verifies:

- exact environment and Web authentication configuration
- successful Web login and generic cloud-function invocation
- hidden active community and both expected memberships
- Web account has no real-community memberships or admin role
- section schema, order, and 30/1/0 counts
- homepage, section, detail, and profile read paths return real data

A doctor failure stops validation with a specific cause and never repairs production automatically.

## Concurrency and Lease Boundary

The immutable baseline is safe for concurrent reads, so normal H5 validation does not acquire the lease.

The lease remains mandatory for:

- initial provision or explicit reconcile
- shared community, section, or account configuration changes
- tests that mutate the same shared records
- the single machine-wide WeChat DevTools instance

General H5 CRUD uses the real backend, but this delivery does not create a generic concurrent write-fixture framework. Tests that need shared writes remain leased until a future case proves it can be isolated by run ID and exact cleanup.

## Security and Failure Boundaries

- Production `ALLOW_TEST_OPENID` remains disabled.
- The generic `http-gateway` remains disabled and is not expanded.
- Web credentials stay in machine-local configuration and are injected only into browser automation at runtime.
- Public CloudBase client configuration may be bundled; secrets may not.
- Missing, anonymous, expired, or rejected Web sessions fail closed.
- The Web test account is not an admin and must not join real communities.
- Baseline creation and repair never occur during ordinary page startup.
- A future baseline version is provisioned explicitly; old data is never automatically deleted.

## Verification

Repository tests cover:

- Web and mini-program identity resolution, including anonymous rejection and namespace separation
- Web SDK call routing and unchanged mini-program routing
- login recovery, logout ordering, and failed-login state cleanup
- storage adapter normalization for upload and temporary URLs
- hidden-community filtering with continued member access
- provision prepare/apply scoping and idempotency with mocked cloud access
- doctor failures for auth, environment, membership, and data drift
- absence of gateway credentials and arbitrary OpenID injection in the H5 bundle

After the implementation reaches canonical main, one leased provision establishes the real account and baseline. Acceptance then verifies:

1. Two worktrees can authenticate and read the same community concurrently without a lease.
2. H5 homepage, section, detail, profile, and one controlled create/upload path use the real backend.
3. Homepage geometry proves search scrolls away, tabs stick, and long-to-short switching stays stable.
4. A final leased DevTools or real-device check uses the WeChat member of the same community.

## Out of Scope

- A second QA environment or per-worktree backend.
- Per-worktree communities or community creation during H5 startup.
- A custom identity broker, local business API, or signed fake-identity gateway.
- Reimplementing WeChat-only platform capabilities in H5.
- Redesigning existing product pages.
- A generic concurrent CRUD fixture platform or background janitor.
- Automatic destructive cleanup or replacement of the DevTools lease.
