import { callAdmin, callAdminRaw, callAs, createCleanupRegistry, makeRunId } from './lib/test-api.mjs'
import { sanitizeName, writeNamedReport } from './lib/reporting.mjs'

const cleanupRegistry = createCleanupRegistry()
let passed = 0
let failed = 0

if (!process.env.CLOUD_API_URL) {
  throw new Error('CLOUD_API_URL is required for scripts/test-admin-api.mjs')
}

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`PASS ${message}`)
  } else {
    failed++
    console.error(`FAIL ${message}`)
  }
}

async function finish() {
  const cleanup = await cleanupRegistry.cleanupAll(console)
  const exitCode = failed > 0 || !cleanup.ok ? 1 : 0
  const reportDir = process.env.HH_REPORT_DIR || ''

  if (reportDir) {
    await writeNamedReport(reportDir, `${sanitizeName('admin-api-smoke')}.json`, {
      stage: 'admin-api-smoke',
      passed,
      failed,
      cleanup,
      exitCode,
      finishedAt: new Date().toISOString(),
    })
  }

  console.log(`\n[admin-api-smoke] ${passed} passed, ${failed} failed`)
  if (!cleanup.ok) {
    console.error(`[admin-api-smoke] cleanup issues: ${cleanup.issues.map((x) => `${x.communityId}: ${x.message}`).join('; ')}`)
  }
  process.exit(exitCode)
}

async function main() {
  const runId = makeRunId()
  const owner = `admin-api-owner-${runId}`
  const applicant = `admin-api-applicant-${runId}`

  console.log('1) Unauthorized admin request is rejected')
  const unauthorized = await callAdminRaw('__invalid_token__', 'community.list')
  assert(unauthorized.statusCode === 403, `community.list unauthorized returns 403 (got ${unauthorized.statusCode})`)

  console.log('\n2) Authorized admin request returns communities')
  const listRes = await callAdmin('community.list')
  assert(Array.isArray(listRes.communities), 'community.list returns array')

  console.log('\n3) Seed approval-based community through real business flow')
  await callAs(owner, 'user', 'login', { nickName: 'AdminApiOwner', avatarUrl: '' })
  await callAs(applicant, 'user', 'login', { nickName: 'AdminApiApplicant', avatarUrl: '' })

  const { communityId } = await callAs(owner, 'community', 'create', {
    name: `AdminApi-${runId}`,
    description: 'seeded by admin api smoke test',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'approval',
  })
  cleanupRegistry.trackCommunity(communityId)
  assert(!!communityId, `community created: ${communityId}`)

  console.log('\n4) Approve community and verify it becomes active')
  const approveRes = await callAdmin('community.approve', { communityId })
  assert(approveRes.success === true, 'community.approve returns success')

  const activeList = await callAdmin('community.list')
  assert(activeList.communities.some((c) => c._id === communityId && c.status === 'active'), 'approved community appears as active')

  console.log('\n5) Create section and widgets through admin API')
  const { sectionId } = await callAdmin('section.create', {
    communityId,
    name: `Nightly-${runId}`,
    icon: 'book',
    order: 0,
    type: 'realtime',
  })
  assert(!!sectionId, `section created: ${sectionId}`)

  const widgetRes = await callAdmin('section.updateWidgets', {
    sectionId,
    communityId,
    widgets: [{ type: 'short_text', label: '内容', fieldKey: 'title', required: true, showInList: true, widgetId: '' }],
  })
  assert(Array.isArray(widgetRes.widgets) && widgetRes.widgets.length === 1, 'section.updateWidgets returns widgets')

  const sectionList = await callAdmin('section.list', { communityId })
  assert(sectionList.sections.some((s) => s._id === sectionId), 'section.list includes the new section')

  console.log('\n6) Create pending member and verify pending list')
  const applyRes = await callAs(applicant, 'member', 'apply', { communityId })
  assert(applyRes.status === 'pending', `member.apply enters pending status (got ${applyRes.status})`)

  const pendingRes = await callAdmin('member.pendingList', { communityId })
  assert(pendingRes.members.some((m) => m.userId === applicant), 'member.pendingList includes the applicant')

  console.log('\n7) Reject applicant and verify rejected member can be kicked')
  const pendingMember = pendingRes.members.find((m) => m.userId === applicant)
  assert(!!pendingMember?._id, 'pending member record exists for reject/kick flow')

  if (pendingMember?._id) {
    const rejectRes = await callAdmin('member.reject', {
      communityId,
      memberId: pendingMember._id,
    })
    assert(rejectRes.success === true, 'member.reject returns success')

    const rejectedRes = await callAdmin('member.list', {
      communityId,
      status: 'rejected',
    })
    assert(rejectedRes.members.some((m) => m._id === pendingMember._id), 'member.list rejected includes applicant')

    const kickRejectedRes = await callAdmin('member.kick', {
      communityId,
      memberId: pendingMember._id,
    })
    assert(kickRejectedRes.success === true, 'member.kick removes rejected member record')

    const rejectedAfterKickRes = await callAdmin('member.list', {
      communityId,
      status: 'rejected',
    })
    assert(
      rejectedAfterKickRes.members.every((m) => m._id !== pendingMember._id),
      'kicked rejected member no longer appears in rejected list',
    )
  }
}

main()
  .then(finish)
  .catch(async (error) => {
    failed++
    console.error(error?.stack || error?.message || error)
    await finish()
  })
