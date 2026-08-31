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
