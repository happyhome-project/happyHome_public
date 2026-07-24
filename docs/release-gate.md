# HappyHome Release Gate

This is the single repository source for cross-component formal release orchestration, mandatory gates, evidence requirements, upload policy, and final production verification. Component guides may document component-specific build or deployment mechanics, but they do not define a formal HappyHome release. Formal production release work must run only from the clean, synchronized public canonical `main` checkout at `C:\Project\Claude\happyHome_public`, with `HEAD` exactly equal to freshly fetched `origin/main` and `origin` exactly derived from `https://github.com/happyhome-project/happyHome_public.git`. Feature branches, dirty worktrees, stale/ahead/behind main, path or origin mismatch, a missing production lock, failed UI or cloud smoke, and failed fixture cleanup all block publishing.

Before any production mutation, the release session and publish workflow run `npm.cmd run release:preflight` with `HH_RELEASE_HEAD_SHA` set to the intended full 40-hex commit SHA. The value must exactly equal both the canonical workspace `HEAD` and refreshed `origin/main`; a missing, abbreviated, or mismatched value blocks all fixture creation. Formal publish always delegates RAG specialist verification, so this preflight validates the exact SHA, release plan, and resume identity without creating RAG timer/probe fixtures. Failed or indeterminate in-scope findings block release, and fixture cleanup runs in `finally`. Preflight does not deploy, configure, migrate, acquire a formal release lock, or upload a mini-program.

## RAG Release Boundary

RAG specialist verification is delegated in both default and include-RAG releases. The default plan omits `post-rag-worker`, `post-video-rag-worker`, and RAG-specific manifest operations. Set `HH_RELEASE_INCLUDE_RAG=1` or pass `--include-rag` to the release planner only when the release intentionally owns the worker deployment and declared configuration/index operations. Even in that mode, timer verification, backfill, RAG smoke, semantic retrieval, and evaluation remain delegated and are not release acceptance evidence. DAG V2 still runs the common `ensure:indexes` prerequisite in every release; that generic prerequisite is not RAG specialist verification. Do not claim RAG was verified by either formal release mode.

## Full-Current Two-Stage Release

`full-current` is an explicit planning strategy for releasing the exact current public `main`. It ignores the previous production SHA only when calculating the release plan; it never clears, rewrites, or fabricates production state.

The recommended interface generates all operator labels once and reuses one session file:

```powershell
npm.cmd run release:session -- create --full-current
npm.cmd run release:session -- prepare
npm.cmd run release:session -- publish
```

The session contains a machine UUID plus the exact Git SHA, environment, strategy, generated run ID, version and description. Prepare and publish read the same values; operators do not repeat them. Prepare pins the exact Git SHA, package digest and DevTools UI evidence without deploying or uploading. Publish resumes that exact ledger and strategy. The existing production lock, CloudBase deployment, UI evidence, cloud smoke/log capture, fixture cleanup, admin-web deployment, digest verification and mini-program upload rules remain mandatory.

The generated source marker `miniprogram/src/generated/build-info.ts` is release-owned only while prepare or publish is active. After the mini-program upload receipt and component ledger pass, formal publication verifies that the marker exactly matches the current release version and description, then restores the tracked `HEAD` bytes before completing production state. A failed or interrupted release keeps the matching marker for safe resume. A different or additionally edited marker is never overwritten: cleanup fails closed and the release must be resumed after the ownership conflict is resolved.

Before prepare, a mistaken human-readable value can be corrected locally without PR, build or deployment:

```powershell
npm.cmd run release:session -- repair --version=1.0.260716103000 --desc=current-main-abc123 --reason="correct generated labels before prepare"
```

After the formal run exists, its actual run ID/version/description are historical facts. The same repair command records requested values as aliases instead of rewriting package bytes, upload receipts, ledgers or production state. `--repair-latest` may restore only the local latest-run pointer after the run ledger exactly matches the session security identity. Git SHA, environment, component/package digests, upload receipt and cleanup evidence are never repairable labels. Existing manual prepare/publish arguments remain temporarily compatible, but the session entrypoint is the default workflow.

By default, `full-current` ensures the desired non-RAG current state: all 10 planned cloud functions plus admin-web are freshly remotely attested and matching stable component digests skip mutation, while every planned cloud function is still freshly verified and included in smoke. Explicit include-RAG mode expands the cloud set to 12. The mini-program is still uploaded because the platform does not expose an equivalent safe cross-run package attestation. A true all-component mutation is an exceptional operator choice: add `--force-redeploy-current` to both prepare and publish. That flag is valid only with explicit `--full-current`, is pinned in preflight, plan, ledger, and resume identity, and does not weaken any Git, lock, snapshot, verification, smoke, cleanup, or upload gate.

### Immutable artifacts and same-run retry

Prepare also generates the formal release plan and a run-scoped immutable snapshot plus artifact manifest for every planned cloud function and admin-web bundle, while binding the mini-program package digest. Snapshots live under the exact canonical `.codex-local/release-artifacts/<runId>` path and are installed by a same-volume rename; paths outside that run directory, path traversal, and symbolic-link, junction, or reparse entries fail closed. Publish deploys only those snapshot paths, never mutable `dist`. The manifest binds the run ID, full Git SHA, environment, version and description, builder identities, target set, and `contentDigest`. That content digest remains the exact immutable-snapshot/TOCTOU proof and is intentionally run-specific.

Each of the fourteen deployable components—twelve cloud functions, admin-web, and miniprogram—also has a stable `componentDigest`. It hashes canonical source files, relevant component/root configuration, the root lockfile, and an explicit builder/toolchain version; it excludes Git SHA, run ID, timestamps, random probe tokens, and output ordering. Cloud functions additionally publish a runtime file-manifest digest. These stable identities decide cross-run desired-state equality, while `contentDigest` continues to protect the exact bytes used by the current run. A missing, replaced, or changed snapshot hard-blocks before any deploy. Cloud probe tokens remain only inside controlled local cloud snapshots; the ledger, events, errors, summaries, logs, manifest, and production state may contain only the token hash and non-secret build identity.

Publish and same-run retry never skip a remote component from an old passed ledger stage alone. Each cloud function first tries the token from the current digest-verified snapshot. For cross-run equality it may then use only a prior token recovered from the production state's exact `artifactRunId`, canonical immutable snapshot path, content digest, token hash, component digest, and runtime digest. Missing, legacy, or tampered provenance becomes unattestable and deploys; a token is never derived from or replaced by a public digest. A fresh response must match function name, stable component digest, runtime digest, and dynamic runtime-file verification. A cross-run skip preserves the prior deployed artifact/token provenance; a same-run exact attestation or actual deploy adopts the current binding.

Every CloudBase CLI attempt rechecks that function snapshot after the production mutation fence and immediately before process start. Each invoke has a bounded timeout that terminates and observes closure of its CLI process tree; timeout may mark one function deploy-required only after the runner settles and the token payload is removed, while unconfirmed cleanup hard-blocks the release. After selective deployment, every planned function is verified again and every planned function remains in cloud smoke, including zero-mutation full-current runs. Admin-web cross-run equality requires both its stable component digest and a fresh SSH readback that compares the complete live file set and rehashes every live file against the retained publication manifest before trusting the marker. A missing, mismatched, or unreadable marker/manifest is `unattestable` and deploys from the pinned snapshot. Aliyun archives carry a deterministic per-file SHA-256 manifest, are hash-checked before every upload/SSH step and again remotely before extraction, and may write the publication marker or switch `current` only after the extracted file set and every file hash verify. Targets without a reliable readback mechanism are never guessed to be current. Mini-program cross-run skip is intentionally unsupported; only an exact same-run normalized upload receipt can be reused on resume, and the DevTools release UI gate remains mandatory.

Remote attestation is read-only and may run before a mutation fence. Every following production mutation still refreshes and validates canonical `main` through `ProductionReleaseGuard`; main drift therefore blocks the next deploy, reload, migration, or upload. Temporary fixture cleanup remains inside `finally` and is attempted even when later fetch or drift validation fails. Ledger schema 3 is additive and still reads schema 1/2 runs. It records per-component stable/runtime digests and provenance alongside `attested`, `deployed`, `verified`, or `uploaded` status, skip reasons, remote attestations, and real deployed/skipped totals without rewriting historical production success state. Release-plan actions are closed to deploy-safe desired-state operations: `ensure-indexes`, `configure-rag-workers`, and `update-rag-env`; migrations remain confined to `migrations[]`. RAG timer proof, backfill, smoke, retrieval, and semantic evaluation are not valid release actions. Every migration input digest binds its ID, confined ordinary module path, and exact module bytes; only the same recorded digest may skip. A legacy record without a digest or a reused ID with changed bytes fails closed rather than guessing equality or rerunning an irreversible migration.

### Release DAG V2

Formal release defaults to `HH_RELEASE_DAG_V2=v2`. Every run consumes the release preflight contract, immutable artifact attestation, and the common `ensure:indexes` prerequisite. The default non-RAG run then deploys or attests and freshly verifies the 10 planned cloud functions before terminal admin-web and mini-program publication. Include-RAG mode expands the planned deployment and declared configuration/index operations, but the RAG timer, backfill, smoke, retrieval, and semantic-evaluation gates remain delegated. Terminal publication cannot run after any in-scope release branch fails.

Remote Git fetch/revalidation occurs at named mutation boundaries rather than before every cloud invoke or CLI command. Every individual mutation still receives the production guard plus a local clean/exact-SHA fence, and immutable snapshots are rechecked immediately before deploy. Timer and cloud fixtures use dedicated cleanup fences: abort or Git drift cannot suppress cleanup, all cleanup promises settle before the ledger records terminal failure, and concurrent ledger stage writes are serialized.

The deploy-only DAG mode is bound into the release ledger and cannot be downgraded with `HH_RELEASE_DAG_V2=0`. The retired order ran live RAG fixtures, timer proof, backfill and semantic gates inside publication; restoring it would violate the RAG release boundary. Emergency recovery must start a new release run using the same deploy-only ordering.

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

The default evidence path is `npm.cmd run test:mp:release-ui`. It opens the built `mp-weixin` package through WeChat DevTools automator and must output all six labels. The compiled `dist/build/mp-weixin/generated/build-info.js` identity is authoritative for the package being tested. The profile/build identity check runs before fixture provisioning, so a package mismatch fails without creating release test data.

To build and validate the mini-program UI once before formal prepare, write an exact reusable qualification explicitly:

```powershell
npm.cmd run release:ui-qualify -- --version=<version> --desc=<description> --ui-qualification=<absolute-json-path>
```

This command only writes build-info, builds the mini-program, runs the existing release gate and writes the qualification after the full UI gate passes. It does not deploy cloud functions or admin-web, upload the mini-program, acquire the production release lock, or create a production release run. The qualification is bound to the exact Git SHA, version, description, compiled package identity and digest, UI evidence and installed WeChat DevTools version. The source build-info hash is retained as provenance, but restoring the tracked source marker after a build does not invalidate unchanged package bytes or their UI qualification.

Pass that same absolute file explicitly to formal prepare with `--ui-qualification=<absolute-json-path>`. A valid qualification skips the duplicate mini-program build and DevTools UI run while the normal cloud/admin artifact pinning continues. Package bytes, compiled identity, UI evidence, Git SHA, project path or DevTools identity changes hard-block prepare; it never falls back to rebuilding. A version or description argument mismatch is repaired by rerunning prepare with the qualification's recorded metadata, without rebuilding or rerunning UI. Publish does not accept this flag and instead freshly revalidates the qualification already pinned in the prepare ledger.

- `HH_RELEASE_HOME_COLD_START_NONEMPTY`: the cold-start home shell renders non-empty content.
- `HH_RELEASE_HOME_IMAGES_RENDERED`: the home feed renders its required images.
- `HH_RELEASE_HOME_ARCHIVE_TABS_STICKY`: visible archive topic tabs pin below the search surface and preserve their filtered feed.
- `HH_RELEASE_HOME_DETAIL_NONEMPTY`: home feed tap opens a non-empty detail page.
- `HH_RELEASE_LOGIN_VERSION`: the logged-out profile exposes and validates the build version through the non-visual `data-build-version` attribute; version text must not be visible.
- `HH_RELEASE_PROFILE_LOGIN_CLEAN`: the logged-out profile has exactly one visible login identity entry and no visible build version or developer diagnostics.

The script writes machine-readable evidence under `.codex-local/release-evidence/`. It first uses the current DevTools app state; if that has no tappable posts, it injects the release test fixture (`HH_RELEASE_TEST_OPENID` / `HH_RELEASE_TEST_COMMUNITY_ID`, defaulting to the existing QingShan test fixture), refreshes the Pinia stores, and retries.

`auto-replay` is optional. If `HH_REQUIRE_RELEASE_REPLAY=1` or `HH_MP_REPLAY_CONFIG_PATH` is set, the gate also runs the recorded replay check. Replay is no longer the default proof because the DevTools CLI can directly expose an automator websocket with hidden `--auto-port`.

Without all 6 release UI labels, the gate must fail and the mini-program must not be uploaded. If WeChat DevTools has no usable way to create or run the evidence, report that as a DevTools capability blocker instead of publishing.

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
- `HH_CLOUD_INVOKE_SMOKE_COLLABORATION_TEMPLATE`
- `HH_CLOUD_INVOKE_SMOKE_POST`
- `HH_CLOUD_INVOKE_SMOKE_HTTP_GATEWAY`
- `HH_CLOUD_INVOKE_SMOKE_WECHAT_AUDIT_CALLBACK`
- `HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE`
- `HH_CLOUD_LOG_CAPTURE_POST`
- `HH_CLOUD_FIXTURE_CLEANUP_OK`

The admin fixture path invokes the `admin` function directly with a controlled `_actAs` superAdmin identity, creates an `HH_RELEASE_SMOKE_*` community/section/post, verifies it through admin list APIs, then runs `community.disable` and `community.hardDelete`. Cleanup failure blocks release.

### WeChat media audit callback

Deploy `wechat-audit-callback` as a dedicated HTTPS HTTP function. In the Mini Program console, configure its exact URL as the message-push endpoint with JSON data format and plaintext mode. The console token must exactly equal the strong `WX_MESSAGE_TOKEN` stored only in `~/.happyhome/cam.env` and the callback function environment; `WX_APPID` must also match. After the callback function exists, run `scripts/update-admin-env.mjs` so `post` receives `WX_APPID/WX_APPSECRET` and the callback receives `WX_APPID/WX_MESSAGE_TOKEN`. Secret values must never appear in release output or evidence.

The console GET verification must return `echostr` only for a valid WeChat signature. Production acceptance creates an isolated image post through the real mini-program path, records text `pass`, image `pending -> pass`, automatic member visibility, and fixture deletion. Invalid signature, wrong AppID, unsupported/encrypted payload, callback persistence failure, or an image task that remains pending blocks production verification. Rollback disables the message-push URL and restores the previous callback configuration; it must not auto-approve pending posts. Retry old pending posts explicitly only after the repaired callback is live.

As defined in [RAG Release Boundary](#rag-release-boundary), default formal cloud smoke excludes `post-rag-worker` and `post-video-rag-worker`, while retaining real smoke coverage for admin, collaboration-template, community, home-prefetch, http-gateway, member, post, section, user, and wechat-audit-callback.

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

The one-time `global-collaboration-templates` production data transition is complete. Its repository migration command and executor were retired after verification; future releases have no global-collaboration data migration step. Historical design and implementation records remain under `docs/superpowers/` and Git history.

- If WeChat public platform automation is unavailable, report that the uploaded development build still needs to be selected as the trial version in the WeChat backend.
- Only claim true-device success when there is recorded replay evidence or user-provided phone test evidence.
