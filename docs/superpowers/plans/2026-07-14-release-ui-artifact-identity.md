# Release UI Artifact Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make release UI validation package-centric, fast-fail before fixtures, and tolerant of restored source build metadata without weakening package or UI gates.

**Architecture:** A focused package-identity helper reads the compiled artifact. The UI runner consumes that identity and moves its existing profile gate before fixture work. Qualification inspection treats source-marker changes as provenance drift while retaining hard checks on immutable artifacts and behavior evidence.

**Tech Stack:** Node.js ESM, `node:test`, WeChat DevTools automator, existing release qualification and ledger helpers.

---

### Task 1: Package identity reader

**Files:**
- Create: `scripts/lib/miniprogram-package-identity.mjs`
- Create: `scripts/lib/miniprogram-package-identity.test.mjs`

- [ ] Write tests that parse compiled `BUILD_INFO`, reject missing fields, and reject a `buildId` that does not match `mp-<version>`.
- [ ] Run `node --test scripts/lib/miniprogram-package-identity.test.mjs` and verify RED because the module does not exist.
- [ ] Implement `parseMiniprogramPackageIdentity(text)` and `readMiniprogramPackageIdentity(projectPath)` with exact field validation.
- [ ] Rerun the targeted test and verify GREEN.

### Task 2: UI fast identity gate

**Files:**
- Modify: `scripts/test-mp-release-ui.mjs`
- Modify: `scripts/lib/mp-release-ui-policy.test.mjs`
- Modify: `scripts/lib/release-ui-check-runner.mjs`
- Modify: `scripts/lib/release-ui-check-runner.test.mjs`

- [ ] Add tests proving the runner obtains expected identity from the selected dist project and calls `coldStart`, then `profile`, before `provisionFixture`.
- [ ] Add a test proving profile failure skips fixture, archive, and detail while cleanup still executes.
- [ ] Run the two targeted test files and verify RED against the current source-based identity and fixture-first ordering.
- [ ] Replace `expectedBuildVersion()` with the package identity reader and pass its version to profile verification.
- [ ] Reorder the existing release UI stages without changing their assertions or cleanup guarantee.
- [ ] Rerun the two targeted test files and verify GREEN.

### Task 3: Repairable source-marker drift

**Files:**
- Modify: `scripts/lib/release-ui-qualification.mjs`
- Modify: `scripts/lib/release-ui-qualification.test.mjs`

- [ ] Change the existing source-build-info mutation test to expect successful inspection with `sourceBuildInfo.matchesQualification=false`; retain all immutable artifact mutation cases as rejection tests.
- [ ] Run `node --test scripts/lib/release-ui-qualification.test.mjs` and verify RED because source drift currently throws.
- [ ] Record source hash/identity status during inspection without using it as a qualification invalidation condition.
- [ ] Parse and exactly validate compiled dist identity through the new helper.
- [ ] Rerun the qualification tests and verify GREEN.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/release-gate.md`

- [ ] Document that package digest, compiled identity, and UI behavior are hard gates while restored source build-info is repairable metadata.
- [ ] Run `node --test scripts/lib/miniprogram-package-identity.test.mjs scripts/lib/release-ui-check-runner.test.mjs scripts/lib/release-ui-qualification.test.mjs scripts/lib/mp-release-ui-policy.test.mjs`.
- [ ] Run `npm.cmd run test:mp:replay-policy`.
- [ ] Run `npm.cmd run test:governance` and `git diff --check`.
- [ ] Review the diff for scope, commit as AngryBird, push, open one PR, and track `pr-ci / offline` plus Merge Queue to `MERGED`.

