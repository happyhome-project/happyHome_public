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

`gate` requires `HH_MP_REPLAY_CONFIG_PATH`. The replay file or directory must contain both labels:

- `HH_RELEASE_HOME_DETAIL_NONEMPTY`: home feed tap opens a non-empty detail page.
- `HH_RELEASE_LOGIN_VERSION`: login page renders and shows the build version.

Without those recorded replay labels, the gate must fail and the mini-program must not be uploaded.

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
