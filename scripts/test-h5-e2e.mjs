/**
 * E2E test against real CloudBase via http-gateway.
 *
 * Runs the full business flow:
 *   1. User Alice registers (login creates new user)
 *   2. Alice creates a community
 *   3. Admin approves it
 *   4. Admin creates a section with a required widget
 *   5. User Bob registers, joins the community
 *   6. Bob creates a post
 *   7. Bob lists posts, verifies his appears
 *   8. Alice tries to delete Bob's post — should be rejected
 *   9. Bob deletes his own post — succeeds, soft-delete verified
 *  10. Bob tries to post to a different (unjoined) community — should fail
 *
 * Env (optional):
 *   CLOUD_API_URL  (default: prod CloudBase host)
 *   ADMIN_TOKEN    (default: happyhome-admin-2024)
 *
 * Exit code: 0 on pass, 1 on any assertion or unexpected failure.
 */

import http from 'node:http'
import https from 'node:https'

const BASE = (process.env.CLOUD_API_URL || 'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com').replace(/\/+$/, '')
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

const RUN_ID = Date.now().toString(36)
const ALICE = `e2e-alice-${RUN_ID}`
const BOB = `e2e-bob-${RUN_ID}`

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

function step(name) {
  console.log(`\n— ${name}`)
}

function request(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const transport = u.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body)
    const req = transport.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let parsed = {}
        try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = { raw } }
        resolve({ statusCode: res.statusCode || 0, data: parsed })
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// Call business function via http-gateway, as a test user
async function callAs(openid, fnName, action, params = {}) {
  const res = await request(
    `${BASE}/http-gateway`,
    { _fn: fnName, action, ...params },
    { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-test-openid': openid },
  )
  if (res.statusCode !== 200) {
    const msg = res.data?.error || JSON.stringify(res.data)
    const err = new Error(`[${fnName}/${action}] ${res.statusCode}: ${msg}`)
    err.statusCode = res.statusCode
    err.data = res.data
    throw err
  }
  return res.data
}

async function callAdmin(action, params = {}) {
  const res = await request(
    `${BASE}/admin`,
    { action, ...params },
    { authorization: `Bearer ${ADMIN_TOKEN}` },
  )
  if (res.statusCode !== 200) {
    throw new Error(`[admin ${action}] ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }
  return res.data
}

async function expectReject(fn, label) {
  try {
    await fn()
    failed++
    console.error(`  ✗ ${label}: expected rejection but succeeded`)
  } catch (err) {
    passed++
    console.log(`  ✓ ${label} (rejected: ${String(err.message).slice(0, 80)})`)
  }
}

async function main() {
  console.log(`E2E test against ${BASE}`)
  console.log(`Alice=${ALICE}  Bob=${BOB}\n`)

  let communityId, sectionId, widgetId, postId

  step('1. Alice registers')
  const aliceLogin = await callAs(ALICE, 'user', 'login', { nickName: 'AliceE2E', avatarUrl: '' })
  assert(aliceLogin.isNew === true, 'Alice is a new user')
  assert(aliceLogin.user._id === ALICE, `user._id matches injected openid (${ALICE})`)

  step('2. Alice creates a community')
  const createRes = await callAs(ALICE, 'community', 'create', {
    name: `E2E社区-${RUN_ID}`,
    description: 'auto-created by e2e',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'open',
  })
  communityId = createRes.communityId
  assert(!!communityId, `community created: ${communityId}`)

  step('3. Admin approves community')
  const approveRes = await callAdmin('community.approve', { communityId })
  assert(approveRes.success === true, 'community approved')

  step('4. Admin creates section + adds widget')
  const sectionRes = await callAdmin('section.create', {
    communityId,
    name: '讨论区',
    icon: '💬',
    order: 0,
  })
  sectionId = sectionRes.sectionId
  assert(!!sectionId, `section created: ${sectionId}`)
  const widgetsRes = await callAdmin('section.updateWidgets', {
    sectionId,
    widgets: [{ type: 'text', label: '内容', required: true, showInList: true, widgetId: '' }],
  })
  widgetId = widgetsRes.widgets[0].widgetId
  assert(!!widgetId, `widget created: ${widgetId}`)

  step('5. Bob registers + joins open community')
  await callAs(BOB, 'user', 'login', { nickName: 'BobE2E', avatarUrl: '' })
  const joinRes = await callAs(BOB, 'member', 'apply', { communityId })
  assert(joinRes.status === 'active', `Bob joined (status=${joinRes.status})`)

  step('6. Bob posts')
  const postRes = await callAs(BOB, 'post', 'create', {
    communityId,
    sectionId,
    content: { [widgetId]: 'Hello from Bob E2E' },
  })
  postId = postRes.postId
  assert(!!postId, `post created: ${postId}`)

  step('7. Bob sees the post in list')
  const listRes = await callAs(BOB, 'post', 'list', { sectionId })
  const myPost = listRes.posts.find((p) => p._id === postId)
  assert(!!myPost, 'post appears in list')
  assert(myPost?.authorId === BOB, `authorId === ${BOB}`)
  assert(myPost?.content[widgetId] === 'Hello from Bob E2E', 'content preserved')

  step('8. Alice cannot delete Bob\'s post')
  await expectReject(
    () => callAs(ALICE, 'post', 'delete', { postId }),
    'Alice rejected deleting Bob\'s post',
  )

  step('9. Bob deletes his own post')
  const delRes = await callAs(BOB, 'post', 'delete', { postId })
  assert(delRes.success === true, 'delete succeeded')
  const afterList = await callAs(BOB, 'post', 'list', { sectionId })
  assert(!afterList.posts.some((p) => p._id === postId), 'post removed from active list (soft-deleted)')
  await expectReject(
    () => callAs(BOB, 'post', 'get', { postId }),
    'post.get on deleted returns error',
  )

  step('10. Bob posts to a different (unjoined) community — rejected')
  // Use the first other active community (there's likely a legacy one from earlier dev)
  const allCommunities = await callAs(BOB, 'community', 'list', {})
  const otherCommunity = allCommunities.communities.find((c) => c._id !== communityId)
  if (otherCommunity) {
    await expectReject(
      () => callAs(BOB, 'post', 'create', {
        communityId: otherCommunity._id,
        sectionId: 'any-section',
        content: { placeholder: 'x' },
      }),
      'Bob rejected posting to unjoined community',
    )
  } else {
    console.log('  (skipped — only one community in system)')
  }

  // ---- Summary ----
  console.log(`\n${'='.repeat(50)}`)
  console.log(`E2E result: ${passed} passed, ${failed} failed`)
  console.log(`Run id: ${RUN_ID}`)
  console.log(`Leftover test data (for debugging):`)
  console.log(`  community: ${communityId}`)
  console.log(`  section:   ${sectionId}`)
  console.log(`  alice:     ${ALICE}`)
  console.log(`  bob:       ${BOB}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('\n❌ E2E crashed')
  console.error(err)
  process.exit(2)
})
