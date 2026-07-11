# HappyHome open tasks

This is the single repository backlog for open, claimable work. Each item must state the current evidence and a concrete outcome. Completed work belongs in Git history and, when useful, a change fragment; observations without a deliverable belong in an issue or the relevant reference document.

## P1 - Complete worktree concurrency governance

**Current evidence:** the public baseline has worktree create, doctor, bootstrap, status, sync, and retirement tooling. It intentionally does not share `node_modules`, symlink private keys, or allocate ports automatically.

**Claimable outcomes:**

- Determine whether WeChat DevTools requires a repository-level singleton resource lock, based on observed concurrent behavior rather than port assumptions.
- Define a cross-worktree semantic-conflict check that does not mutate or merge sibling feature branches.
- Decide whether fixed local ports are necessary; if they are, specify collision, recovery, and retirement behavior before implementation.

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
