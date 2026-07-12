import { createHash } from 'node:crypto'

export const FIXTURE_KEY = 'HH_WEB_H5_V1'
export const COMMUNITY_ID = 'hh-web-h5-v1-community'
const CREATED_AT = '2026-01-01T00:00:00.000Z'

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function documentEntries(manifest) {
  return [
    ...manifest.users.map((document) => ({ collection: 'users', id: document._id, document })),
    ...manifest.memberships.map((document) => ({ collection: 'community_members', id: document._id, document })),
    ...manifest.communities.map((document) => ({ collection: 'communities', id: document._id, document })),
    ...manifest.sections.map((document) => ({ collection: 'sections', id: document._id, document })),
    ...manifest.posts.map((document) => ({ collection: 'posts', id: document._id, document })),
  ]
}

export function buildManifest({ webUserId = null, wechatOpenid }) {
  const sectionSpecs = [
    ['long', '完整资料', '📚', 30],
    ['short', '简短动态', '✏️', 1],
    ['empty', '空白板块', '🗂️', 0],
  ]
  const sections = sectionSpecs.map(([suffix, name, icon, fixturePostCount], order) => ({
    _id: `hh-web-h5-v1-section-${suffix}`,
    communityId: COMMUNITY_ID,
    name,
    icon,
    order,
    enableComment: true,
    enableLike: true,
    type: 'evergreen',
    status: 'active',
    widgets: [{ widgetId: `hh-web-h5-v1-widget-${suffix}`, type: suffix === 'long' ? 'rich_text' : 'short_text', label: '内容', fieldKey: 'content', required: suffix !== 'empty', order: 0, showInList: suffix !== 'long' }],
    fixturePostCount,
    fixtureKey: FIXTURE_KEY,
    createdAt: CREATED_AT,
  }))
  const authorId = webUserId || 'web:pending-account'
  const posts = sections.flatMap((section) => Array.from({ length: section.fixturePostCount }, (_, index) => ({
    _id: `hh-web-h5-v1-post-${section.order}-${String(index + 1).padStart(2, '0')}`,
    communityId: COMMUNITY_ID,
    sectionId: section._id,
    authorId,
    status: 'active',
    auditStatus: 'pass',
    auditReason: 'fixture pre-approved',
    auditUpdatedAt: CREATED_AT,
    content: { [section.widgets[0].widgetId]: section.order === 0 ? `<p>固定测试帖子 ${index + 1}</p>` : `固定测试帖子 ${index + 1}` },
    commentCount: 0,
    likeCount: 0,
    isPinned: false,
    isFeatured: false,
    fixtureKey: FIXTURE_KEY,
    createdAt: new Date(Date.parse(CREATED_AT) + index * 1000).toISOString(),
    updatedAt: new Date(Date.parse(CREATED_AT) + index * 1000).toISOString(),
  })))
  const users = [
    ...(webUserId ? [{ _id: webUserId, nickName: 'H5 Web Test User', avatarUrl: '', role: 'user', fixtureKey: FIXTURE_KEY, createdAt: CREATED_AT }] : []),
    { _id: wechatOpenid, nickName: 'WeChat Test User', avatarUrl: '', role: 'user', fixtureKey: FIXTURE_KEY, createdAt: CREATED_AT },
  ]
  const memberships = [
    ...(webUserId ? [{ _id: 'hh-web-h5-v1-member-web', communityId: COMMUNITY_ID, userId: webUserId, role: 'member', status: 'active', appliedAt: CREATED_AT, joinedAt: CREATED_AT, fixtureKey: FIXTURE_KEY }] : []),
    { _id: 'hh-web-h5-v1-member-wechat', communityId: COMMUNITY_ID, userId: wechatOpenid, role: 'member', status: 'active', appliedAt: CREATED_AT, joinedAt: CREATED_AT, fixtureKey: FIXTURE_KEY },
  ]
  return {
    version: 1,
    fixtureKey: FIXTURE_KEY,
    users,
    memberships,
    communities: [{ _id: COMMUNITY_ID, name: 'HappyHome H5 固定测试社区', description: 'H5 v1 deterministic test tenant', coverImage: '', location: { address: 'Test only', lat: 0, lng: 0, coordSystem: 'gcj02', source: 'manual' }, joinType: 'approval', creatorId: authorId, status: 'active', discoverable: false, memberCount: 2, fixtureKey: FIXTURE_KEY, createdAt: CREATED_AT }],
    sections,
    posts,
  }
}

function accountUserId(account) {
  const uuid = String(account?.uuid || account?.UUId || '')
  return uuid ? `web:${uuid}` : null
}

function validateObservation(observation, manifest) {
  const webUserId = accountUserId(observation.account)
  for (const membership of observation.memberships || []) {
    if (webUserId && membership.userId !== webUserId) continue
    if (membership.role === 'admin') throw new Error('Web account has forbidden admin role')
    if (membership.communityId !== COMMUNITY_ID) throw new Error('Web account has forbidden real-community membership')
  }
  for (const { collection, id } of documentEntries(manifest)) {
    const observed = observation.documents?.[`${collection}/${id}`]
    if (observed && observed.fixtureKey !== FIXTURE_KEY) throw new Error(`foreign deterministic document collision: ${collection}/${id}`)
  }
  for (const [key, observed] of Object.entries(observation.documents || {})) {
    const id = key.slice(key.indexOf('/') + 1)
    if (id.startsWith('hh-web-h5-v1-') && observed && observed.fixtureKey !== FIXTURE_KEY) throw new Error(`foreign deterministic document collision: ${key}`)
  }
}

export async function planTenant({ store, config }) {
  const observation = await store.inspect({ username: config.username, wechatOpenid: config.wechatOpenid, fixtureKey: FIXTURE_KEY })
  const manifest = buildManifest({ webUserId: accountUserId(observation.account), wechatOpenid: config.wechatOpenid })
  validateObservation(observation, manifest)
  const sets = documentEntries(manifest).filter(({ collection, id, document }) => JSON.stringify(stable(observation.documents?.[`${collection}/${id}`] ?? null)) !== JSON.stringify(stable(document)))
  return {
    envId: config.envId,
    observation,
    observationFingerprint: fingerprint(observation),
    manifestFingerprint: fingerprint(manifest),
    plan: { createAccount: !observation.account, sets, deletes: [] },
  }
}

export function createPrepareRecord(result) {
  const record = {
    version: 1,
    fixtureKey: FIXTURE_KEY,
    envId: result.envId,
    expected: {
      accountExists: Boolean(result.observation.account),
      observedDocumentCount: Object.keys(result.observation.documents || {}).length,
      observedMembershipCount: (result.observation.memberships || []).length,
      observationFingerprint: result.observationFingerprint,
    },
    diff: { createAccount: result.plan.createAccount, setCount: result.plan.sets.length, deleteCount: 0 },
    manifestFingerprint: result.manifestFingerprint,
    planFingerprint: fingerprint(result.plan),
  }
  return { ...record, fingerprint: fingerprint(record) }
}

export function serializePrepareRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`
}

function verifyPrepare(prepare, config) {
  if (prepare.envId !== config.envId) throw new Error('prepare envId does not match current envId')
  if (prepare.fixtureKey !== FIXTURE_KEY) throw new Error('prepare fixture key is invalid')
  const { fingerprint: claimed, ...body } = prepare
  if (!claimed || claimed !== fingerprint(body)) throw new Error('prepare fingerprint is invalid')
}

export async function applyTenant({ store, config, prepare, env = process.env }) {
  if (env.HAPPYHOME_FIXTURE_PREFIX !== FIXTURE_KEY) throw new Error(`apply requires HAPPYHOME_FIXTURE_PREFIX=${FIXTURE_KEY}`)
  verifyPrepare(prepare, config)
  let planned = await planTenant({ store, config })
  if (planned.observationFingerprint !== prepare.expected.observationFingerprint) throw new Error('observed state changed since prepare')
  if (fingerprint(planned.plan) !== prepare.planFingerprint) throw new Error('plan fingerprint changed since prepare')
  if (!planned.observation.account) {
    await store.createEndUser({ username: config.username, password: config.password })
    planned = await planTenant({ store, config })
  }
  for (const { collection, id, document } of planned.plan.sets) await store.setDocument(collection, id, document)
  return await doctorTenant({ store, config })
}

export async function doctorTenant({ store, config }) {
  const observation = await store.inspect({ username: config.username, wechatOpenid: config.wechatOpenid, fixtureKey: FIXTURE_KEY })
  if (!observation.account) throw new Error('Web auth account is missing')
  if (observation.account.disabled) throw new Error('Web auth account is disabled')
  const manifest = buildManifest({ webUserId: accountUserId(observation.account), wechatOpenid: config.wechatOpenid })
  validateObservation(observation, manifest)
  const expectedMemberships = manifest.memberships.map((member) => member._id).sort()
  const observedMemberships = (observation.memberships || []).map((member) => member._id).sort()
  if (JSON.stringify(observedMemberships) !== JSON.stringify(expectedMemberships) || (observation.memberships || []).some((member) => member.status !== 'active' || member.role !== 'member' || member.fixtureKey !== FIXTURE_KEY)) {
    throw new Error('invalid fixture community membership set')
  }
  const sections = manifest.sections
  const observedSections = Object.entries(observation.documents || {}).filter(([key, doc]) => key.startsWith('sections/') && doc.communityId === COMMUNITY_ID)
  if (observedSections.length !== 3) throw new Error(`invalid section count: ${observedSections.length}`)
  const totalCounts = sections.map((section) => Object.entries(observation.documents || {}).filter(([key, doc]) => key.startsWith('posts/') && doc.sectionId === section._id).length)
  if (JSON.stringify(totalCounts) !== JSON.stringify([30, 1, 0])) throw new Error(`invalid total post counts: ${totalCounts.join('/')}`)
  const counts = sections.map((section) => Object.entries(observation.documents || {}).filter(([key, doc]) => key.startsWith('posts/') && doc.sectionId === section._id && doc.status === 'active' && doc.auditStatus === 'pass').length)
  if (JSON.stringify(counts) !== JSON.stringify([30, 1, 0])) throw new Error(`invalid active post counts: ${counts.join('/')}`)
  const expected = documentEntries(manifest)
  for (const { collection, id, document } of expected) {
    if (JSON.stringify(stable(observation.documents?.[`${collection}/${id}`] ?? null)) !== JSON.stringify(stable(document))) throw new Error(`fixture document mismatch: ${collection}/${id}`)
  }
  return { ok: true, envId: config.envId, fixtureKey: FIXTURE_KEY, account: 'present', status: 'hidden/active/approval', counts: { communities: 1, sections: 3, posts: 31, memberships: 2, activePostsBySection: counts } }
}
