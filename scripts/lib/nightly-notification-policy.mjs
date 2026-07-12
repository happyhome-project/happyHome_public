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

export function createNotificationPlan({ webhook, timestamp = new Date().toISOString(), env = process.env }) {
  if (webhook) return { shouldRun: true, stage: null, warning: null }

  return {
    shouldRun: false,
    stage: {
      key: 'notify-wecom',
      name: 'WeCom notification',
      status: 'skipped',
      startedAt: timestamp,
      finishedAt: timestamp,
      durationMs: 0,
      command: '',
      logPath: '',
      notes: 'Skipped because no webhook is configured.',
    },
    warning: formatWorkflowWarning('missing', env),
  }
}

export function renderNightlyMarkdown(summary) {
  const lines = [
    '# HappyHome Nightly Summary',
    '',
    `- Status: ${summary.status}`,
    `- Test status: ${summary.testStatus}`,
    `- Notification status: ${summary.notificationStatus}`,
    `- Branch: ${summary.branch}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Artifact root: ${summary.artifactRoot}`,
    '',
    '## Stages',
  ]

  for (const stage of summary.stages) {
    lines.push(`- ${stage.name}: ${stage.status} (${stage.durationMs} ms)`)
  }

  if (summary.cleanupIssues.length > 0) {
    lines.push('', '## Cleanup Issues')
    for (const issue of summary.cleanupIssues) {
      lines.push(`- ${issue.communityId}: ${issue.message}`)
    }
  }

  return `${lines.join('\n')}\n`
}

export function finalizeNightlyRun({ summary, notificationStage, env = process.env }) {
  const finalSummary = {
    ...summary,
    status: summary.testStatus,
    notificationStatus: notificationStatusFromStage(notificationStage),
  }
  return {
    summary: finalSummary,
    markdown: renderNightlyMarkdown(finalSummary),
    warning: notificationStage.status === 'failed' ? formatWorkflowWarning('failed', env) : null,
    exitCode: finalSummary.testStatus === 'passed' ? 0 : 1,
  }
}
