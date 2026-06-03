# HappyHome Release Gate

Use `$happyhome-release` for release work from `C:\Project\Claude\happyHome`.

## Before Upload

- Review `main`, `origin/main`, recent commits, working tree status, and git author.
- Fix risky changes before release, especially detail blank screens, login/profile first render, build-info, DevTools CLI, and deploy scripts.
- Run the guard from the repo root:

```powershell
node X:\Users\<user>\.codex\skills\happyhome-release\scripts\happyhome-release-guard.mjs audit
node X:\Users\<user>\.codex\skills\happyhome-release\scripts\happyhome-release-guard.mjs gate
```

`gate` requires DevTools release UI evidence. The release agent must actively create or refresh that evidence when it is missing; it must not stop merely because another session did not provide it.

The default evidence path is `npm.cmd run test:mp:release-ui`. It opens the built `mp-weixin` package through WeChat DevTools automator and must output both labels:

- `HH_RELEASE_HOME_DETAIL_NONEMPTY`: home feed tap opens a non-empty detail page.
- `HH_RELEASE_LOGIN_VERSION`: login page renders and shows the build version.

The script writes machine-readable evidence under `.codex-local/release-evidence/`. It first uses the current DevTools app state; if that has no tappable posts, it injects the release test fixture (`HH_RELEASE_TEST_OPENID` / `HH_RELEASE_TEST_COMMUNITY_ID`, defaulting to the existing QingShan test fixture), refreshes the Pinia stores, and retries.

`auto-replay` is optional. If `HH_REQUIRE_RELEASE_REPLAY=1` or `HH_MP_REPLAY_CONFIG_PATH` is set, the gate also runs the recorded replay check. Replay is no longer the default proof because the DevTools CLI can directly expose an automator websocket with hidden `--auto-port`.

Without the two release UI labels, the gate must fail and the mini-program must not be uploaded. If WeChat DevTools has no usable way to create or run the evidence, report that as a DevTools capability blocker instead of publishing.

## Upload Policy

- Use `npm.cmd run deploy:release` for formal release deploy.
- Use `npm.cmd run deploy:mp:upload` only for mini-program development-build upload.
- Do not use `npm.cmd run deploy:mp` for trial release testing; it generates preview QR artifacts.
- DevTools CLI is the default upload path. If it reports login/signing failures such as `getCloudAPISignedHeader failed`, reopen WeChat DevTools, log in again, and rerun.
- `miniprogram-ci` fallback is only for explicitly requested CI fallback (`--use-ci`). It is not equivalent proof that the WeChat DevTools platform release path passed.

## Version Visibility

- Login page must show the build version so testers can identify the opened build immediately.
- Profile/detail version text is optional. It can be added during debug and removed later for visual quality.

## After Upload

- Verify `miniprogram/src/generated/build-info.ts` and `mp-upload-info.json`.
- If WeChat public platform automation is unavailable, report that the uploaded development build still needs to be selected as the trial version in the WeChat backend.
- Only claim true-device success when there is recorded replay evidence or user-provided phone test evidence.
