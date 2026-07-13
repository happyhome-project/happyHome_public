# HappyHome Release Gate

This is the single repository source for cross-component formal release orchestration, mandatory gates, evidence requirements, upload policy, and final production verification. Component guides may document component-specific build or deployment mechanics, but they do not define a formal HappyHome release. Formal production release work must run only from the clean, synchronized public canonical `main` checkout at `C:\Project\Claude\happyHome_public`, with `HEAD` exactly equal to freshly fetched `origin/main` and `origin` exactly derived from `https://github.com/happyhome-project/happyHome_public.git`. Feature branches, dirty worktrees, stale/ahead/behind main, path or origin mismatch, a missing production lock, failed UI or cloud smoke, and failed fixture cleanup all block publishing.

Before any production mutation, run `npm.cmd run release:preflight` with `HH_RELEASE_HEAD_SHA` set to the intended full 40-hex commit SHA. The value must exactly equal both the canonical workspace `HEAD` and refreshed `origin/main`; a missing, abbreviated, or mismatched value blocks all fixture creation. It aggregates release control-plane and RAG collection checks, the RAG index, worker timers, full-current plan/resume identity, and a unique temporary timer probe. Failed or indeterminate findings block release, and fixture cleanup runs in `finally`. Preflight does not deploy, configure, migrate, acquire a formal release lock, or upload a mini-program.

## Full-Current Two-Stage Release

`full-current` is an explicit planning strategy for releasing the exact current public `main`. It ignores the previous production SHA only when calculating the release plan; it never clears, rewrites, or fabricates production state. Both stages must carry the same explicit flag and pinned identity:

```powershell
$runId = '<YYYYMMDDTHHMMSS>-full-current-public-main'
$version = '1.0.<YYMMDDHHMM>'
$desc = 'full-current-public-main-<short-sha>'
node X:\Users\86136\.codex\skills\happyhome-release\scripts\happyhome-release-guard.mjs prepare -- --full-current --release-run-id=$runId --version=$version --desc=$desc
node X:\Users\86136\.codex\skills\happyhome-release\scripts\happyhome-release-guard.mjs publish -- --full-current --resume --release-run-id=$runId --cloud-deploy-concurrency=2 --cloud-smoke-concurrency=3
```

Create a new run ID for every release attempt. The version and description must already match the checked-in `miniprogram/src/generated/build-info.ts` on clean public `main`; prepare and publish reuse the same values and run ID. Prepare pins that identity, the exact Git SHA, package digest, and DevTools UI evidence without deploying or uploading. Publish must resume that exact ledger and strategy; omitting `--full-current`, changing the identity or digest, or losing any required evidence blocks the release. The existing production lock, CloudBase deployment, UI evidence, cloud smoke/log capture, fixture cleanup, admin-web deployment, digest verification, and mini-program upload rules below remain mandatory.

### Immutable artifacts and same-run retry

Prepare also generates the formal release plan and a run-scoped immutable snapshot plus artifact manifest for every planned cloud function and admin-web bundle, while binding the mini-program package digest. Snapshots live under `.codex-local/release-artifacts/<runId>` and are installed by a same-volume rename; publish deploys only those snapshot paths, never mutable `dist`. The manifest binds the run ID, full Git SHA, environment, version and description, builder identities, target set, and stable content digests. A missing, replaced, or changed snapshot hard-blocks before any deploy. Cloud probe tokens remain only inside each controlled local cloud snapshot; the ledger, events, errors, summaries, logs, manifest, and production state may contain only the token hash and non-secret build identity.

Publish and same-run retry never skip a remote component from an old passed ledger stage alone. Each cloud function is invoked with the token from its digest-verified snapshot and is skipped only when the fresh response exactly matches its function name, build ID, and source SHA. Each invoke has a bounded timeout that terminates its CLI process tree; timeout, CLI failure, or response mismatch marks only that function deploy-required. After selective deployment, every planned function is verified again with the original snapshot probe identity. Admin-web uses the Aliyun `current` publication marker containing its version ID and content digest; a missing, mismatched, or unreadable marker is `unattestable` and deploys from the pinned snapshot. Targets without a reliable readback mechanism are never guessed to be current. Mini-program upload reuse requires the exact prepared package digest, version, description, run ID, and a stable identity derived from the freshly normalized actual upload receipt; the DevTools release UI gate remains mandatory.

Remote attestation is read-only and may run before a mutation fence. Every following production mutation still refreshes and validates canonical `main` through `ProductionReleaseGuard`; main drift therefore blocks the next deploy, reload, migration, or upload. Temporary fixture cleanup remains inside `finally` and is attempted even when later fetch or drift validation fails. The additive ledger schema preserves old run readability and reports per-component `attested`, `deployed`, `verified`, or `uploaded` status, skip reasons, remote attestations, and deployed/skipped totals without rewriting historical production success state.

## Before Upload

- Review `main`, `origin/main`, recent commits, working tree status, and git author.
- Fix risky changes before release, especially detail blank screens, login/profile first render, build-info, DevTools CLI, and deploy scripts.
- Check the shared machine-local validation lease before running DevTools automation:

```powershell
npm.cmd run validation:lease:status
```

An existing lease blocks the protected command. An expired lease is still unknown, not abandoned. Do not stop another owner's process or DevTools, and do not move or delete its cache. Only after confirming the recorded owner process has exited may the release operator recover the exact stale owner explicitly:

```powershell
npm.cmd run validation:lease:recover -- --expected-owner-token=<uuid> --confirm-no-owner --reason="verified recorded owner process exited"
```

- Run the checked-in gates from the repository root:

```powershell
npm.cmd run test:mp:release-gate
npm.cmd run test:mp:release-ui
npm.cmd run test:cloud:release-smoke
```

The release gate requires DevTools release UI evidence. The release operator must actively create or refresh that evidence when it is missing; it must not stop merely because another task did not provide it.

The default evidence path is `npm.cmd run test:mp:release-ui`. It opens the built `mp-weixin` package through WeChat DevTools automator and must output all five labels:

- `HH_RELEASE_HOME_COLD_START_NONEMPTY`: the cold-start home shell renders non-empty content.
- `HH_RELEASE_HOME_IMAGES_RENDERED`: the home feed renders its required images.
- `HH_RELEASE_HOME_DETAIL_NONEMPTY`: home feed tap opens a non-empty detail page.
- `HH_RELEASE_LOGIN_VERSION`: the logged-out profile exposes and validates the build version through the non-visual `data-build-version` attribute; version text must not be visible.
- `HH_RELEASE_PROFILE_LOGIN_CLEAN`: the logged-out profile has exactly one visible login identity entry and no visible build version or developer diagnostics.

The script writes machine-readable evidence under `.codex-local/release-evidence/`. It first uses the current DevTools app state; if that has no tappable posts, it injects the release test fixture (`HH_RELEASE_TEST_OPENID` / `HH_RELEASE_TEST_COMMUNITY_ID`, defaulting to the existing QingShan test fixture), refreshes the Pinia stores, and retries.

`auto-replay` is optional. If `HH_REQUIRE_RELEASE_REPLAY=1` or `HH_MP_REPLAY_CONFIG_PATH` is set, the gate also runs the recorded replay check. Replay is no longer the default proof because the DevTools CLI can directly expose an automator websocket with hidden `--auto-port`.

Without all five release UI labels, the gate must fail and the mini-program must not be uploaded. If WeChat DevTools has no usable way to create or run the evidence, report that as a DevTools capability blocker instead of publishing.

## Cloud Smoke And Logs

Formal release cloud deployment uses the CloudBase CLI/COS route, then runs release-owned cloud invoke smoke and log capture before admin-web deploy and mini-program upload:

```powershell
npm.cmd run deploy:release -- --use-tcb
```

Standalone cloud smoke:

```powershell
npm.cmd run test:cloud:release-smoke -- --env-id cloudbase-3gh862acb1505ff3
```

Standalone deploy plus smoke for selected functions:

```powershell
npm.cmd run deploy:cloud:tcb -- --only=user,post --smoke
```

The smoke evidence is self-generated under `.codex-local/release-evidence/<run>/cloud-smoke/`. It writes `summary.json`, per-function `invoke-*.json`, per-function `log-*.json`, `*-payload.json`, and `cleanup.json`.

Hard release labels:

- `HH_CLOUD_INVOKE_SMOKE_COMMUNITY`
- `HH_CLOUD_INVOKE_SMOKE_MEMBER`
- `HH_CLOUD_INVOKE_SMOKE_POST`
- `HH_CLOUD_INVOKE_SMOKE_HTTP_GATEWAY`
- `HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE`
- `HH_CLOUD_LOG_CAPTURE_POST`
- `HH_CLOUD_FIXTURE_CLEANUP_OK`

The admin fixture path invokes the `admin` function directly with a controlled `_actAs` superAdmin identity, creates an `HH_RELEASE_SMOKE_*` community/section/post, verifies it through admin list APIs, then runs `community.disable` and `community.hardDelete`. Cleanup failure blocks release.

`user` and `section` direct invokes intentionally record OPENID/membership guard evidence instead of forcing production `ALLOW_TEST_OPENID`. Real user OPENID flows remain covered by the mini-program release UI evidence. CloudBase `fn log` can intermittently return `GetFunctionLogDetail InternalError` for non-critical functions; those failures are stored as warnings. The `post.clientLog` runId log is the required log gate and still blocks release if missing.

## Upload Policy

- Use `npm.cmd run deploy:release -- --use-tcb` for formal release deploy.
- Use `npm.cmd run deploy:mp:upload` only for mini-program development-build upload.
- Do not use `npm.cmd run deploy:mp` for trial release testing; it generates preview QR artifacts.
- DevTools CLI is still the mini-program upload path. If it reports login/signing failures such as `getCloudAPISignedHeader failed`, reopen WeChat DevTools, log in again, and rerun.
- The old DevTools cloud-function deploy path is retained only as a legacy/manual diagnostic route; it is not the formal release cloud path.
- `miniprogram-ci` fallback is only for explicitly requested CI fallback (`--use-ci`). It is not equivalent proof that the WeChat DevTools platform release path passed.

## Version Visibility

- Login page must show the build version so testers can identify the opened build immediately.
- Profile/detail version text is optional. It can be added during debug and removed later for visual quality.

## After Upload

- Verify `miniprogram/src/generated/build-info.ts` and `mp-upload-info.json`.
- Verify the completed release from the canonical main workspace:

```powershell
npm.cmd run release:status
npm.cmd run release:lock -- status
npm.cmd run release:pending
```

The remote production state shown by the lock status must match the exact run ID and Git SHA; the local ledger and upload evidence must be `passed` and match the version and description; the production lock must be absent; and `release:pending` must report `required=false`. If remote completion succeeded but the local ledger is incomplete, reconcile that exact run; never edit the ledger or production state by hand:

```powershell
npm.cmd run release:reconcile -- --run-id=$runId
```
- If WeChat public platform automation is unavailable, report that the uploaded development build still needs to be selected as the trial version in the WeChat backend.
- Only claim true-device success when there is recorded replay evidence or user-provided phone test evidence.
