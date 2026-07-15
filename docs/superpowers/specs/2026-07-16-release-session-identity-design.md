# Release Session Identity Design

> **Historical / point-in-time:** This specification records the release-session design accepted for the 2026-07-16 implementation. It does not override later operational policy.
> **Current authority:** Use the [formal release gate](../../release-gate.md), repository rules, current release code, and tests.

## Objective

Reduce formal release operator input to one local session file and make metadata mistakes recoverable without rebuilding, redeploying, uploading again, or opening a pull request. Security identity remains exact and fail-closed.

## First principles

A release has two different kinds of identity:

- Security identity proves the bytes and environment: full Git SHA, environment ID, component/runtime digests, mini-program package digest, upload receipt, and fixture cleanup evidence.
- Operator labels help humans find a release: readable run ID, mini-program version, description, and display aliases.

Only security identity can authorize reuse of evidence or production completion. Labels must never substitute for digests or receipts.

## Interface

`npm.cmd run release:session -- create --full-current` creates one untracked JSON file under `.codex-local/release-sessions/`. It generates a UUID session ID, readable run ID, mini-program version, description, exact Git SHA, environment and strategy. A collision is resolved before any production action by adding a short UUID suffix.

`npm.cmd run release:session -- prepare --session=<path>` and `publish --session=<path>` read that file and invoke the existing guarded release entrypoint with the same generated values. Operators no longer repeat run ID, version or description.

`npm.cmd run release:session -- repair --session=<path> [--run-id=<value>] [--version=<value>] [--desc=<value>] [--display-name=<value>]` behaves according to release state:

- Before the formal run exists, readable run ID, version and description are editable labels and are atomically updated in the session.
- After the formal run exists, its actual run ID, version and description remain historical facts. Requested corrections are recorded as aliases with an audit entry; package bytes, ledger context and upload receipt are unchanged.
- If the session's local ledger pointer is missing or stale, repair may atomically restore only `.codex-local/release-runs/latest.json` after the exact run ledger matches the session Git SHA, version and description.

Repair never edits a formal run ledger, production state, artifact manifest, package bytes, upload evidence or Git metadata. Existing explicit release-lock recovery remains the only lock recovery mechanism because it requires verified owner-process absence and remote fencing evidence.

## Validation and failure behavior

Every command validates schema, UUID, full Git SHA, canonical workspace, main branch and exact `HEAD=origin/main`. Prepare/publish additionally reject a session whose immutable fields differ from the formal ledger. Repair rejects changes to session ID, Git SHA, environment, strategy or run ID.

The session file is written atomically. Each repair appends old value, new value, reason and timestamp. No secrets are stored.

## Compatibility

Existing `prepare` and `publish` commands remain available for one release cycle. The session command is the recommended entrypoint and simply delegates to the current guarded implementation; it does not create a second release engine.

## Acceptance

- One create command produces all release values without operator arithmetic.
- Prepare and publish receive identical values from the same file.
- A pre-prepare label correction completes locally without PR or rebuild.
- A post-prepare correction records an alias and resumes the existing run without changing package digest or ledger.
- Git SHA, package digest, upload receipt or environment mismatches still block.
- Existing formal release policy, UI gate, non-RAG cloud smoke and cleanup remain unchanged.
