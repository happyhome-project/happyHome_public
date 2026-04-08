/**
 * 用法：
 * node scripts/set-super-admin.mjs <openId> [apiBaseUrl] [adminToken]
 *
 * 示例：
 * node scripts/set-super-admin.mjs oxxxxxxxxx
 * node scripts/set-super-admin.mjs oxxxxxxxxx https://<env-id>-<uin>.ap-shanghai.app.tcloudbase.com happyhome-admin-2024
 */

import http from 'node:http'
import https from 'node:https'

function postJson(urlString, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const payload = JSON.stringify(body)
    const transport = url.protocol === 'https:' ? https : http

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          const statusCode = res.statusCode || 500
          let parsed
          try {
            parsed = data ? JSON.parse(data) : {}
          } catch {
            parsed = { raw: data }
          }
          if (statusCode >= 200 && statusCode < 300) {
            resolve(parsed)
          } else {
            reject(new Error(`HTTP ${statusCode}: ${JSON.stringify(parsed)}`))
          }
        })
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  const openId = process.argv[2]
  const apiBaseUrl = process.argv[3] || process.env.CLOUD_API_URL
  const adminToken = process.argv[4] || process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

  if (!openId) {
    console.error('缺少 openId。用法: node scripts/set-super-admin.mjs <openId> [apiBaseUrl] [adminToken]')
    process.exit(1)
  }
  if (!apiBaseUrl) {
    console.error('缺少 apiBaseUrl。请作为第二个参数传入，或设置环境变量 CLOUD_API_URL。')
    process.exit(1)
  }

  const endpoint = apiBaseUrl.replace(/\/$/, '') + '/admin'
  const result = await postJson(
    endpoint,
    { action: 'user.setSuperAdmin', openId },
    { Authorization: `Bearer ${adminToken}` }
  )

  console.log('设置成功:', result)
}

main().catch((err) => {
  console.error('设置失败:', err.message || err)
  process.exit(1)
})
