# HappyHome open tasks

This is the single repository backlog for open, claimable work. Each item must state the current evidence and a concrete outcome. Completed work belongs in Git history and, when useful, a change fragment; observations without a deliverable belong in an issue or the relevant reference document.

## P1 - Triage dependency security exposure

**Current evidence:** the 2026-08-31 audit of the public baseline reported 142 dependency findings (44 critical); `npm.cmd audit --omit=dev --json` still reported 131 (44 critical). Root `dependencies` include deployment tooling such as `miniprogram-ci`, so omit-dev counts are not a measure of remotely exploitable production vulnerabilities. See the [dated project review](./docs/changes/2026-08-31-project-reconciliation.md) for scope.

**Claimable outcome:** map high/critical findings to the actual cloud bundles, browser bundles, and local build/upload tools; assess reachability and supported upgrade paths, then propose scoped fixes with compatibility tests. Do not bulk-apply `npm audit fix --force`. This is unassigned triage, not a scheduled upgrade or a confirmed production exploit.

## P1 - Resolve remaining worktree concurrency questions

**Current evidence:** the public baseline has worktree create, doctor, bootstrap, status, sync, and retirement tooling. A machine-local validation lease already serializes protected DevTools automation and `fixture-write` commands; its ownership/recovery rules are in [AGENTS.md](./AGENTS.md). It intentionally does not share `node_modules`, symlink private keys, or allocate ports automatically.

**Claimable outcomes:**

- Define a cross-worktree semantic-conflict check that does not mutate or merge sibling feature branches.
- Decide whether fixed local ports are necessary; if they are, specify collision, recovery, and retirement behavior before implementation.

These remaining design questions are unassigned and unscheduled. Investigate when reproducing a semantic integration conflict or a local port collision; do not add a second DevTools lock without evidence that the existing lease is insufficient.

## P1 - Make trusted workflow validation fail closed per command

**Current evidence:** the 2026-08-31 review of `24f7f293241337487ed2b712cdde53f1a6f92be6` found that `.github/workflows/trusted-workflow-validator.yml` runs several native commands without checking each exit code and writes fixed `passed` values into its attestation. An early native-command failure can be masked by a later success; this is a source/exit-propagation finding, not evidence that a specific historical GitHub run falsely passed. See [PR mechanism review](./docs/github-pr-mechanism.md#8-本次复核发现的边界和待修项).

**Claimable outcome:** under the independent trust-root review required by AGENTS, make every selected gate propagate failure and derive attestation outcomes from completed checks; test an injected failure at each command position and prove no successful attestation or apply is accepted. Do not let the candidate validator approve its own change, weaken required checks, or treat the current attestation alone as proof of all constituent tests. This item is unassigned; the documentation review does not authorize workflow or Ruleset changes.

## P2 - Align legacy post-checkout preflight with public worktree roles

**Current evidence:** `scripts/lib/worktree-policy.mjs` still defaults to the private `C:\Project\Claude\happyHome` path, and `scripts/worktree-preflight.mjs` uses it for post-checkout validation; public create/retire use the newer public operator checks. The old `integrate:pr` also imports that constant and remains prohibited by AGENTS for public collaboration.

**Claimable outcome:** scope a public-worktree preflight fix with tests for public main, feature worktrees, private/unknown origins and operation failures; preserve the stronger production boundary and do not revive the private integration path. A post-checkout error must not be described as rolling back the Git checkout. Handle any integration trust-root changes through the separate authorized review path. No unrelated worktree or branch cleanup.

## P2 - Implement comments and likes

**Current evidence:** the data model reserves space for comments and likes, but no end-to-end product flow is implemented.

**Claimable outcome:** write a scoped design covering permissions, counters, deletion behavior, UI states, and tests before implementation.

## P3 - Reassess mini-program automation coverage

**Current evidence:** the supported operational path is documented in [testing operations](./docs/TESTING.md) and the [release gate](./docs/release-gate.md). Older SDK assumptions about an automation WebSocket must not be treated as current capability.

**Claimable outcome:** identify a concrete missing user journey, reproduce the gap on the supported DevTools path, and add a stable test without weakening release evidence.

## Backlog item template

```markdown
## Priority - Outcome

**Current evidence:** what is true in the public repository now.

**Claimable outcome:** the bounded artifact or behavior to deliver.
```
