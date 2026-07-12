# Optional Nightly Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WeCom delivery optional and non-blocking while preserving an explicit notification result for future Feishu integration.

**Architecture:** Extract pure nightly result and notification policy from the orchestration script, then let the orchestrator record notification delivery separately from test status. Keep the WeCom transport focused on one delivery attempt and sanitize its errors; provider selection and Feishu delivery remain out of scope.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, GitHub Actions workflow commands, existing HappyHome reporting/process helpers.

---

## File map

- Create `scripts/lib/nightly-notification-policy.mjs`: required execution env, test-result derivation, notification-result derivation, and sanitized warning emission.
- Create `scripts/lib/nightly-notification-policy.test.mjs`: pure policy regression tests.
- Create `scripts/lib/notify-wecom.test.mjs`: transport behavior tests using an in-process HTTP server; no real webhook.
- Modify `scripts/nightly-full.mjs`: consume the policy, skip absent notification configuration, preserve test exit status, and write separate result fields.
- Modify `scripts/notify-wecom.mjs`: expose a testable sender and remove the required-webhook mode and response-body leakage.
- Modify `package.json`: include the new tests in `test:governance`.
- Modify `scripts/lib/docs-policy.test.mjs`: assert the workflow/orchestrator contract keeps notification optional.

### Task 1: Define the result policy with failing tests

**Files:**
- Create: `scripts/lib/nightly-notification-policy.test.mjs`
- Create: `scripts/lib/nightly-notification-policy.mjs`

- [ ] **Step 1: Write the failing policy tests**

Cover these exact assertions with `node:test`:

```js
assert.equal(REQUIRED_NIGHTLY_ENV.includes('WECOM_WEBHOOK_URL'), false)
assert.deepEqual(deriveNightlyResult({ stages: [], cleanupIssues: [] }), {
  status: 'passed', testStatus: 'passed'
})
assert.equal(deriveNightlyResult({ stages: [{ status: 'failed' }], cleanupIssues: [] }).testStatus, 'failed')
assert.equal(notificationStatusFromStage({ status: 'skipped' }), 'skipped')
assert.equal(notificationStatusFromStage({ status: 'passed' }), 'sent')
assert.equal(notificationStatusFromStage({ status: 'failed' }), 'failed')
assert.equal(
  formatWorkflowWarning('failed', { GITHUB_ACTIONS: 'true' }),
  '::warning::WeCom notification failed'
)
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test scripts/lib/nightly-notification-policy.test.mjs`

Expected: FAIL because `nightly-notification-policy.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

Export:

```js
export const REQUIRED_NIGHTLY_ENV = [
  'CLOUD_API_URL', 'GATEWAY_TOKEN', 'TEST_COMMUNITY_ID',
  'VITE_CLOUD_API_URL', 'VITE_ADMIN_USERNAME', 'VITE_ADMIN_PASSWORD',
]
export function deriveNightlyResult({ stages, cleanupIssues }) {
  const failed = stages.some((stage) => ['failed', 'recovered_flaky'].includes(stage.status))
    || cleanupIssues.length > 0
  const testStatus = failed ? 'failed' : 'passed'
  return { status: testStatus, testStatus }
}
export function notificationStatusFromStage(stage) {
  if (stage.status === 'passed') return 'sent'
  if (stage.status === 'skipped') return 'skipped'
  return 'failed'
}
export function formatWorkflowWarning(kind, env = process.env) {
  const message = kind === 'missing'
    ? 'WeCom notification skipped because no webhook is configured'
    : 'WeCom notification failed'
  return env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `Warning: ${message}`
}
```

Sanitization must use a fixed public message category and must not interpolate webhook URLs, HTTP bodies, tokens, or raw thrown errors.

- [ ] **Step 4: Run the policy tests and verify GREEN**

Run: `node --test scripts/lib/nightly-notification-policy.test.mjs`

Expected: all policy tests pass with zero failures.

- [ ] **Step 5: Commit the policy unit**

```powershell
git add scripts/lib/nightly-notification-policy.mjs scripts/lib/nightly-notification-policy.test.mjs
git commit -m "test: define optional nightly notification policy"
```

### Task 2: Make WeCom transport optional and sanitized

**Files:**
- Create: `scripts/lib/notify-wecom.test.mjs`
- Modify: `scripts/notify-wecom.mjs`

- [ ] **Step 1: Write failing transport tests**

Use an in-process `node:http` server and import an exported `sendWeComNotification` function. Assert:

```js
await assert.rejects(
  sendWeComNotification({ webhook: badUrl, summary }),
  /status 500/
)
assert.equal(capturedError.includes('sensitive-response-body'), false)
assert.deepEqual(await sendWeComNotification({ webhook: goodUrl, summary }), { status: 'sent' })
assert.deepEqual(await sendWeComNotification({ webhook: '', summary }), { status: 'skipped' })
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test scripts/lib/notify-wecom.test.mjs`

Expected: FAIL because the sender is not exported and the current error includes the response body.

- [ ] **Step 3: Implement the minimal transport boundary**

Export `sendWeComNotification({ webhook, summary, env })`. Return `{ status: 'skipped' }` for an empty webhook and `{ status: 'sent' }` after a 2xx response. Throw only `WeCom webhook failed with status <code>` for non-2xx responses. Preserve the CLI wrapper behind an ESM direct-execution guard and remove `HH_REQUIRE_WECOM`.

- [ ] **Step 4: Run the transport tests and verify GREEN**

Run: `node --test scripts/lib/notify-wecom.test.mjs`

Expected: all tests pass; no real network endpoint is contacted.

- [ ] **Step 5: Commit the transport unit**

```powershell
git add scripts/notify-wecom.mjs scripts/lib/notify-wecom.test.mjs
git commit -m "fix: make WeCom notification delivery optional"
```

### Task 3: Integrate independent notification status into nightly

**Files:**
- Modify: `scripts/nightly-full.mjs`
- Modify: `scripts/lib/docs-policy.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing contract tests**

Update the docs-policy test to assert:

```js
assert.doesNotMatch(orchestration, /requiredEnvVars[\s\S]*WECOM_WEBHOOK_URL/)
assert.match(orchestration, /notificationStatus/)
assert.doesNotMatch(orchestration, /summary\.status\s*=\s*'failed'/)
assert.match(packageJson.scripts['test:governance'], /nightly-notification-policy\.test\.mjs/)
assert.match(packageJson.scripts['test:governance'], /notify-wecom\.test\.mjs/)
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test scripts/lib/docs-policy.test.mjs`

Expected: FAIL because the orchestrator still requires WeCom and lets notification failure overwrite summary status.

- [ ] **Step 3: Implement orchestration changes**

Replace the local required-env and status logic with the policy module. Before notification, write:

```js
const { status, testStatus } = deriveNightlyResult({ stages, cleanupIssues })
```

If the webhook is absent, append a synthetic `notify-wecom` stage with `status: 'skipped'` and emit a sanitized warning. If present, run the existing command stage; on failure emit a sanitized warning. Always assign:

```js
summary.notificationStatus = notificationStatusFromStage(notifyStage)
summary.status = summary.testStatus
```

Exit non-zero only when `summary.testStatus !== 'passed'`. Add both new test files to `test:governance`.

- [ ] **Step 4: Run focused and governance tests**

Run:

```powershell
node --test scripts/lib/nightly-notification-policy.test.mjs scripts/lib/notify-wecom.test.mjs scripts/lib/docs-policy.test.mjs
npm.cmd run test:governance
```

Expected: focused tests and the full governance suite pass with zero failures.

- [ ] **Step 5: Commit the integration**

```powershell
git add scripts/nightly-full.mjs scripts/lib/docs-policy.test.mjs package.json
git commit -m "fix: decouple nightly tests from notifications"
```

### Task 4: Final verification and PR

**Files:**
- Verify all modified files and the approved spec/plan.

- [ ] **Step 1: Run fresh full verification**

```powershell
npm.cmd run test:governance
npm.cmd run docs:check
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: governance and docs checks pass, diff check is clean, and the only branch difference is committed work.

- [ ] **Step 2: Synchronize latest public main safely**

Run the repository `worktree:sync-main -- --prepare`, apply only with the reported exact head/main SHAs, then rerun the full verification if main advanced.

- [ ] **Step 3: Push and open a ready PR**

Push `codex/optional-nightly-notifications` and create a ready PR describing the separate test/notification statuses, warning behavior, test evidence, no deployment, and future Feishu boundary.

- [ ] **Step 4: Follow CI and Merge Queue**

Wait for `pull_request` CI, address only scoped failures, enqueue through Merge Queue, wait for `merge_group` CI, and verify public main advances to the merge commit.
