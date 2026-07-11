# Documentation authority governance

## Status

Implemented on the `codex/docs-authority-governance` feature branch. This fragment is a point-in-time delivery record, not a current operational authority.

## Change

- Assigned one responsibility to each repository entry point: project landing page, mandatory collaboration boundaries, collaboration playbook, documentation catalog, and open backlog.
- Added machine-readable `current`, `operational`, `reference`, `historical`, and `generated` catalog categories with authority levels.
- Made explicit deprecated or archived status override path-based current classification.
- Made `docs:check` reject delivery plans, specifications, collection news indexes, and prototype handoffs that lack an explicit historical status plus a labeled current-authority link.
- Classified plans, specifications, change fragments, dated news, and prototype design handoffs as historical records without deleting them.
- Retired `docs/NOTES.md` as a duplicate backlog and moved its open deliverables to `TASKS.md`.
- Kept test principles separate from executable testing operations and made `docs/release-gate.md` the sole authority for cross-component formal release orchestration, gates, and evidence.
- Replaced the Admin Web template README with repository-specific development, environment, and entry-point guidance.
- Removed machine-specific paths and private design-account details from tracked Markdown where found.

## Boundary

This change classifies retained plans and design deliveries; it does not claim that their content has been semantically merged into current product guidance. It changes no workflow, business code, deployment target, shared environment, or production data.
