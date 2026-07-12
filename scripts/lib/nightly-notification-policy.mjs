export const REQUIRED_NIGHTLY_ENV = [
  'CLOUD_API_URL',
  'GATEWAY_TOKEN',
  'TEST_COMMUNITY_ID',
  'VITE_CLOUD_API_URL',
  'VITE_ADMIN_USERNAME',
  'VITE_ADMIN_PASSWORD',
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
