# HappyHome collaboration playbook

This file describes stable day-to-day engineering habits. It does not override [AGENTS.md](./AGENTS.md), duplicate release instructions, or track project status.

## Start a task

1. Read [README.md](./README.md) and [AGENTS.md](./AGENTS.md).
2. Run `npm.cmd run worktree:doctor` and report the repository root, branch, HEAD, and worktree status.
3. Read only the task-relevant documents from the [documentation map](./docs/README.md).
4. Check [TASKS.md](./TASKS.md) only when claiming or updating backlog work.
5. Confirm scope and side effects before changing shared cloud state, deployment state, or user data.

## Engineering habits

- Verify facts from the active code, command output, or maintained documentation instead of relying on session memory.
- Keep changes scoped. Report adjacent cleanup opportunities instead of performing unrequested cleanup.
- Test through real entry points and event shapes. Use the [testing principles](./docs/TESTING-PRINCIPLES.md) to choose cases and [testing operations](./docs/TESTING.md) for commands.
- Prefer isolated, temporary fixtures for authorized end-to-end checks and clean them up reliably.
- Do not commit private session records, credentials, local exports, or machine-specific paths.
- Update the relevant canonical document when behavior or operations change. Add a fragment under `docs/changes/` when a reviewable change record is useful.

## Sources of truth

| Need | Authority |
|---|---|
| Repository overview | [README.md](./README.md) |
| Mandatory collaboration and production boundaries | [AGENTS.md](./AGENTS.md) |
| Documentation status and ownership | [docs/README.md](./docs/README.md) |
| Open, claimable work | [TASKS.md](./TASKS.md) |
| Test selection principles | [docs/TESTING-PRINCIPLES.md](./docs/TESTING-PRINCIPLES.md) |
| Test commands and layers | [docs/TESTING.md](./docs/TESTING.md) |
| Release and upload procedure | [docs/release-gate.md](./docs/release-gate.md) |

Implementation plans, specifications, change fragments, news snapshots, design handoffs, and documents marked deprecated or archived are point-in-time records. They may explain past decisions, but they do not override current authorities or the code.
