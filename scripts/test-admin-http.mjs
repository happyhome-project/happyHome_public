/**
 * 云端真实测试（Admin HTTP 入口）
 *
 * 必填环境变量：
 *   CLOUD_API_URL=https://<env-id>-<uin>.ap-shanghai.app.tcloudbase.com
 *
 * 可选环境变量：
 *   ADMIN_TOKEN=happyhome-admin-2024
 *   TEST_COMMUNITY_ID=<communityId>   # 配置后会额外验证 section.list / member.pendingList
 *
 * 用法：
 *   node scripts/test-admin-http.mjs
 */

import http from 'node:http'
import https from 'node:https'

function normalizeBaseUrl(urlString) {
  const normalized = String(urlString || '').trim().replace(/\/+$/, '')
  if (!normalized) return ''
  if (!/^https?:\/\//i.test(normalized)) return ''
  return normalized
}

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
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          let parsed = {}
          try {
            parsed = raw ? JSON.parse(raw) : {}
          } catch {
            parsed = { raw }
          }
          resolve({
            statusCode: res.statusCode || 0,
            data: parsed,
          })
        })
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function callAdmin(baseUrl, token, action, params = {}) {
  const endpoint = `${baseUrl}/admin`
  return postJson(
    endpoint,
    { action, ...params },
    { Authorization: `Bearer ${token}` }
  )
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.CLOUD_API_URL)
  const token = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'
  const testCommunityId = String(process.env.TEST_COMMUNITY_ID || '').trim()

  if (!baseUrl) {
    console.error('❌ 缺少 CLOUD_API_URL（需 http/https 完整地址）')
    process.exit(1)
  }

  console.log('🌐 Admin HTTP 真实测试开始')
  console.log(`   CLOUD_API_URL = ${baseUrl}`)
  console.log(`   TEST_COMMUNITY_ID = ${testCommunityId || '(未设置)'}`)

  console.log('\n1) 未授权请求应被拒绝')
  const unauthorized = await callAdmin(baseUrl, '__invalid_token__', 'community.list')
  assert(unauthorized.statusCode === 401, `期望 401，实际 ${unauthorized.statusCode}`)
  console.log('   ✓ 鉴权拒绝正常')

  console.log('\n2) 授权请求 community.list')
  const listRes = await callAdmin(baseUrl, token, 'community.list')
  assert(listRes.statusCode === 200, `community.list 失败，HTTP ${listRes.statusCode}`)
  assert(Array.isArray(listRes.data.communities), 'community.list 响应缺少 communities 数组')
  console.log(`   ✓ 获取 communities 成功，数量: ${listRes.data.communities.length}`)

  if (testCommunityId) {
    console.log('\n3) 授权请求 section.list')
    const sectionRes = await callAdmin(baseUrl, token, 'section.list', { communityId: testCommunityId })
    assert(sectionRes.statusCode === 200, `section.list 失败，HTTP ${sectionRes.statusCode}`)
    assert(Array.isArray(sectionRes.data.sections), 'section.list 响应缺少 sections 数组')
    console.log(`   ✓ 获取 sections 成功，数量: ${sectionRes.data.sections.length}`)

    console.log('\n4) 授权请求 member.pendingList')
    const pendingRes = await callAdmin(baseUrl, token, 'member.pendingList', { communityId: testCommunityId })
    assert(pendingRes.statusCode === 200, `member.pendingList 失败，HTTP ${pendingRes.statusCode}`)
    assert(Array.isArray(pendingRes.data.members), 'member.pendingList 响应缺少 members 数组')
    console.log(`   ✓ 获取 pending members 成功，数量: ${pendingRes.data.members.length}`)
  } else {
    console.log('\n3) 跳过 section/member 细项验证（未配置 TEST_COMMUNITY_ID）')
  }

  console.log('\n✅ Admin HTTP 真实测试通过')
}

main().catch((err) => {
  console.error('\n❌ Admin HTTP 真实测试失败')
  console.error(err.message || err)
  process.exit(1)
})
