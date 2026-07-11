# HappyHome documentation authority and catalog

This is the canonical map for repository documentation. A document's category describes how it may be used; links do not promote a historical or supporting document into an authority.

## Authority order

When documents disagree, use this order:

1. Executable code, tests, and checked-in configuration for implemented behavior.
2. [AGENTS.md](../AGENTS.md) for mandatory PR, CI, worktree, and production boundaries.
3. The canonical current or operational document named below for its subject.
4. Supporting references.
5. Historical records, including plans, specifications, change fragments, news snapshots, design drops, and documents explicitly marked deprecated or archived.

`README.md` is the project landing page, `CLAUDE.md` is the stable collaboration playbook, this file owns documentation classification, and `TASKS.md` is the only repository backlog. None of them should duplicate cross-component formal release orchestration, gates, or evidence.

## Categories

| Category | Meaning |
|---|---|
| `current` | Current entry point or canonical policy for a subject. |
| `operational` | Maintained commands and runbooks. Follow within the permissions in `AGENTS.md`. |
| `reference` | Supporting explanation, inventory, or checklist; verify against code and a canonical document. |
| `historical` | Point-in-time record. Never use as current instructions without revalidation. |
| `generated` | Tool output. Non-authoritative and normally untracked. |

Run `npm.cmd run docs:catalog` for the machine-readable catalog and `npm.cmd run docs:check` for required-entry and repository-relative link checks. The catalog forces explicit deprecated or archived headers to `historical` even if their path would otherwise be current.

## Current authorities

- [Repository overview](../README.md)
- [Mandatory collaboration boundaries](../AGENTS.md)
- [Collaboration playbook](../CLAUDE.md)
- [Open tasks](../TASKS.md)
- [Testing principles](TESTING-PRINCIPLES.md): how to select user, permission, cold-start, and concurrency cases.
- [Interaction principles](UX-PRINCIPLES.md): current behavior principles; visual values come from the current Figma source and checked-in styles.

## Operational guides

- [Setup and local environment](SETUP.md)
- [Testing layers and commands](TESTING.md)
- [Release gate](release-gate.md): the only source for cross-component formal release orchestration, mandatory gates, evidence, upload policy, and final production verification. Component guides remain authoritative only for their component-specific mechanics.
- [Formal post RAG](post-rag-search.md)
- [Admin web deployment](admin-web-deploy.md)
- [Approval notifications](approval-notifications.md)
- [H5 preview](h5-preview-runbook.md)

## Supporting references

- [Figma alignment inventory](figma-mini-0626-inventory.md): confirmed design observations, not a replacement for the current Figma file or implemented styles.
- [CloudBase HTTP access](cloudbase-http-access.md)
- [Mini-program pre-fetch](miniprogram-pre-fetch.md)
- [UI click regression checklist](ui-click-regression-checklist.md)
- [Adversarial testing preparation](adversarial-testing-prep.md): a point-in-time risk inventory; current commands remain in `TESTING.md` and `release-gate.md`.

## Historical and delivery records

- `docs/superpowers/plans/` and `docs/superpowers/specs/`: point-in-time implementation plans and approved design specifications.
- `docs/changes/`: change fragments describing individual branches or deliveries; status text must not be read as current branch state later.
- `news/`: dated content snapshots.
- `prototype/`: design handoffs and prototype drops, not production code or current product authority.
- [Historical project notes](NOTES.md): retired duplicate backlog.
- [Design brief](DESIGN-BRIEF.md), [design tokens](DESIGN-TOKENS.md), [UI library](UI-LIBRARY.md), and [visual tone](VISUAL-TONE.md): deprecated v1 or retired component guidance retained for traceability.

Historical files are not deleted merely because they are stale. Their header must identify the status and link to the current authority when one exists. This catalog does not claim that every historical design has been semantically merged into current guidance.
