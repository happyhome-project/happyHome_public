# HappyHome Release Gate

This is the single repository source for release commands, evidence requirements, upload policy, and post-upload verification. Release work must run from the authorized clean `main` checkout defined by [AGENTS.md](../AGENTS.md); feature worktrees may read this guide but must not publish.

## Before Upload

- Review `main`, `origin/main`, recent commits, working tree status, and git author.
- Fix risky changes before release, especially detail blank screens, login/profile first render, build-info, DevTools CLI, and deploy scripts.
- Run the checked-in gates from the repository root:

```powershell
npm.cmd run test:mp:release-gate
npm.cmd run test:mp:release-ui
npm.cmd run test:cloud:release-smoke
```

The release gate requires DevTools release UI evidence. The release operator must actively create or refresh that evidence when it is missing; it must not stop merely because another task did not provide it.

The default evidence path is `npm.cmd run test:mp:release-ui`. It opens the built `mp-weixin` package through WeChat DevTools automator and must output both labels:

- `HH_RELEASE_HOME_DETAIL_NONEMPTY`: home feed tap opens a non-empty detail page.
- `HH_RELEASE_LOGIN_VERSION`: login page renders and shows the build version.

The script writes machine-readable evidence under `.codex-local/release-evidence/`. It first uses the current DevTools app state; if that has no tappable posts, it injects the release test fixture (`HH_RELEASE_TEST_OPENID` / `HH_RELEASE_TEST_COMMUNITY_ID`, defaulting to the existing QingShan test fixture), refreshes the Pinia stores, and retries.

`auto-replay` is optional. If `HH_REQUIRE_RELEASE_REPLAY=1` or `HH_MP_REPLAY_CONFIG_PATH` is set, the gate also runs the recorded replay check. Replay is no longer the default proof because the DevTools CLI can directly expose an automator websocket with hidden `--auto-port`.

Without the two release UI labels, the gate must fail and the mini-program must not be uploaded. If WeChat DevTools has no usable way to create or run the evidence, report that as a DevTools capability blocker instead of publishing.

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
- If WeChat public platform automation is unavailable, report that the uploaded development build still needs to be selected as the trial version in the WeChat backend.
- Only claim true-device success when there is recorded replay evidence or user-provided phone test evidence.
