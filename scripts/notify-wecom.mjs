import https from 'node:https'
import http from 'node:http'
import { readFile } from 'node:fs/promises'

const summaryPath = process.argv[2] || process.env.HH_SUMMARY_PATH || ''
const webhook = process.env.WECOM_WEBHOOK_URL || ''
const requireWebhook = process.env.HH_REQUIRE_WECOM === '1'

function postJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const payload = JSON.stringify(body)
    const transport = url.protocol === 'https:' ? https : http
    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body: raw })
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function buildRunUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return ''
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
}

function stageSummary(summary) {
  const failedStages = summary.stages.filter((stage) => stage.status === 'failed')
  const flakyStages = summary.stages.filter((stage) => stage.status === 'recovered_flaky')
  const cleanupIssues = summary.cleanupIssues || []
  const runUrl = buildRunUrl()

  const lines = [
    `# HappyHome Nightly ${summary.status === 'passed' ? 'SUCCESS' : 'FAILED'}`,
    `- Branch: ${summary.branch || 'unknown'}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Failed stages: ${failedStages.length}`,
    `- Flaky stages: ${flakyStages.length}`,
    `- Cleanup issues: ${cleanupIssues.length}`,
  ]

  if (failedStages.length > 0) {
    lines.push(`- Failed detail: ${failedStages.map((stage) => stage.name).join(', ')}`)
  }
  if (flakyStages.length > 0) {
    lines.push(`- Flaky detail: ${flakyStages.map((stage) => stage.name).join(', ')}`)
  }
  if (cleanupIssues.length > 0) {
    lines.push(`- Cleanup detail: ${cleanupIssues.map((issue) => `${issue.communityId}: ${issue.message}`).join('; ')}`)
  }
  if (runUrl) {
    lines.push(`- Run: [GitHub Actions](${runUrl})`)
  }

  return lines.join('\n')
}

async function main() {
  if (!summaryPath) {
    throw new Error('Missing summary path')
  }

  if (!webhook) {
    if (requireWebhook) {
      throw new Error('Missing WECOM_WEBHOOK_URL')
    }
    console.log('Skipping WeCom notification because webhook is not configured.')
    return
  }

  const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
  const res = await postJson(webhook, {
    msgtype: 'markdown',
    markdown: {
      content: stageSummary(summary),
    },
  })

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`WeCom webhook failed with status ${res.statusCode}: ${res.body}`)
  }

  console.log('WeCom notification sent.')
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
