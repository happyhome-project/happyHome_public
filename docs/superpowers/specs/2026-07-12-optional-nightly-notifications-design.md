# Optional Nightly Notifications Design

## Goal

Keep HappyHome nightly test execution authoritative even when no notification provider is configured or a configured provider fails. Enterprise WeChat remains an optional delivery channel. A future Feishu provider should be addable without changing test-result semantics.

## Scope

- Remove `WECOM_WEBHOOK_URL` from nightly preflight requirements.
- Preserve the real test and cleanup outcome independently from notification delivery.
- Emit a GitHub Actions warning when notification is skipped or fails.
- Record notification status in the generated summary and artifacts.
- Keep the existing WeCom sender; do not implement Feishu or a general plugin framework in this change.

## Status Model

The orchestrator owns two independent outcomes:

- `testStatus`: `passed` or `failed`, derived only from test stages and cleanup issues.
- `notificationStatus`: `sent`, `skipped`, or `failed`.

The process exit code and top-level nightly `status` are derived only from `testStatus`. A missing webhook, non-2xx response, invalid response, or network error must never change a passing test run into a failed run or hide an existing test failure.

For backward compatibility, top-level `status` remains `passed` or `failed`. The additional fields make the distinction explicit to humans and future notification providers.

## Execution Flow

1. Preflight validates only credentials and fixtures required to execute tests.
2. All test stages run and the orchestrator computes `testStatus`.
3. The summary is written before notification so the sender has an artifact to read.
4. If `WECOM_WEBHOOK_URL` is absent, the notification stage is recorded as `skipped` and emits a GitHub Actions warning.
5. If the webhook is present, the sender attempts delivery. Success records `sent`; any sender error records `failed` and emits a warning.
6. The final summary is rewritten with both outcomes. The process exits non-zero only when `testStatus` is `failed`.

The warning format uses the GitHub workflow command `::warning::...` when `GITHUB_ACTIONS=true`; local runs use a normal warning line. Warning text must not include webhook values or response bodies that could contain sensitive data.

## Future Feishu Boundary

The orchestrator depends only on a small notification result contract (`sent`, `skipped`, or `failed`), not on WeCom-specific success semantics. A future Feishu sender can be selected or invoked alongside WeCom while preserving the same `testStatus` and exit-code rules. This change does not add provider selection, retries, fan-out, or Feishu secrets.

## Tests

Tests must prove the behavior through a red-green cycle:

- Preflight succeeds without `WECOM_WEBHOOK_URL`.
- Missing webhook produces `notificationStatus=skipped`, emits a warning, and preserves a passing test exit code.
- Successful notification produces `notificationStatus=sent` without changing test status.
- HTTP or network notification failure produces `notificationStatus=failed`, emits a sanitized warning, and preserves the real test exit code.
- A failing test remains failed whether notification is skipped, sent, or failed.
- Summary markdown and JSON expose test and notification outcomes separately.

The tests must not call a real webhook, shared cloud environment, deploy target, or release path.

## Non-goals

- Implementing Feishu notifications.
- Making notification delivery a required gate.
- Retrying delivery or persisting a notification queue.
- Changing nightly test coverage, test fixtures, cloud configuration, or Runner lifecycle.
