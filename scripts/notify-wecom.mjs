import https from 'node:https'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function postJson(urlString, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('WeCom webhook request failed'))
    let url
    try {
      url = new URL(urlString)
    } catch {
      fail()
      return
    }
    const payload = JSON.stringify(body)
    const transport = url.protocol === 'https:' ? https : http
    let req
    try {
      req = transport.request(
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
          const statusCode = res.statusCode || 0
          res.once('end', () => resolve({ statusCode }))
          res.once('aborted', fail)
          res.once('error', fail)
          res.once('close', () => {
            if (!res.complete) fail()
          })
          res.resume()
        }
      )
    } catch {
      fail()
      return
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      fail()
    })
    req.once('error', fail)
    req.write(payload)
    req.end()
  })
}

function buildRunUrl(env) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return ''
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
}

function stageSummary(summary, env) {
  const failedStages = summary.stages.filter((stage) => stage.status === 'failed')
  const flakyStages = summary.stages.filter((stage) => stage.status === 'recovered_flaky')
  const cleanupIssues = summary.cleanupIssues || []
  const runUrl = buildRunUrl(env)

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

export async function sendWeComNotification({ webhook, summary, env = {}, timeoutMs = 10_000 }) {
  if (!webhook) {
    return { status: 'skipped' }
  }

  const res = await postJson(webhook, {
    msgtype: 'markdown',
    markdown: {
      content: stageSummary(summary, env),
    },
  }, timeoutMs)

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`WeCom webhook failed with status ${res.statusCode}`)
  }

  return { status: 'sent' }
}

async function main() {
  const summaryPath = process.argv[2] || process.env.HH_SUMMARY_PATH || ''
  const webhook = process.env.WECOM_WEBHOOK_URL || ''

  if (!summaryPath) {
    throw new Error('Missing summary path')
  }

  if (!webhook) {
    console.log('Skipping WeCom notification because webhook is not configured.')
    return
  }

  const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
  await sendWeComNotification({ webhook, summary, env: process.env })

  console.log('WeCom notification sent.')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error)
    process.exit(1)
  })
}
