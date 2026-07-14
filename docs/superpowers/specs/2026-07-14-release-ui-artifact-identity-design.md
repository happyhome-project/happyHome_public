# Release UI Artifact Identity Design

## Goal

Make HappyHome release UI qualification trust the package that DevTools actually runs, fail before fixture work when that package identity is wrong, and keep a valid qualification reusable after the release-owned source marker is restored.

## First-principles boundary

The release-critical object is the immutable `miniprogram/dist/build/mp-weixin` package. Its directory digest, compiled build identity, UI behavior evidence, DevTools project path, and fixture cleanup remain hard gates.

The tracked `miniprogram/src/generated/build-info.ts` file is a build input and local provenance marker. After a package has been built and qualified, restoring that file does not change the qualified package. Source-marker drift therefore becomes reported metadata instead of invalidating the qualification.

Version or description differences between a requested release and a qualification still stop publication, because the platform label must describe the package being uploaded. The failure is repairable: rerun prepare with the qualification's version and description. It must not rebuild the package or rerun UI.

## Design

1. Add a small package-identity reader for `generated/build-info.js`. It parses exact `version`, `desc`, and `buildId` values and requires `buildId=mp-<version>`.
2. `test-mp-release-ui.mjs` derives `expectedVersion` from the selected DevTools project package, never from the tracked source marker.
3. Run the existing profile/login identity check immediately after cold start and before fixture provisioning. A failed identity check skips fixture-dependent home/detail work; cleanup still always runs.
4. UI qualification keeps recording the source marker hash for provenance. Inspection returns source-marker status but does not reject a package when only that marker changed. Package digest, compiled dist identity, UI evidence digest/markers, project path, Git identity, and DevTools identity remain hard gates.
5. Update release documentation to distinguish immutable package evidence from repairable local metadata.

## Scope

No business API, cloud function, database, deployment target, UI behavior, RAG behavior, workflow file, or historical ledger changes. No new long-running test is added.

## Acceptance

- A test proves the UI runner reads the compiled package identity rather than source build-info.
- A test proves profile identity runs before fixture provisioning and prevents fixture creation on failure.
- A test proves changing only source build-info preserves qualification reuse and reports drift.
- Existing package-byte, dist-identity, UI-marker, UI-result, project-path, Git-SHA, and DevTools-version tamper tests remain blocking.
- `npm.cmd run test:mp:replay-policy` and release governance tests pass.

