/**
 * Seed a realistic demo community with 4 sections and ~15 posts from 5 residents.
 *
 * Designed for a human to browse in the real WeChat miniprogram. The community
 * is open-join (joinType='open') so a real user can self-join and post/comment.
 *
 * Run: node scripts/seed-demo-community.mjs
 *
 * Prints community ID and key section IDs at the end for quick inspection.
 */

import { callAs, callAdmin } from './h5-test/_shared.mjs'

const RUN_ID = Date.now().toString(36).slice(-5)

// ---- Residents (simulated community members) ----
const residents = [
  { openid: `demo-zhang-${RUN_ID}`, nickName: '张阿姨', avatarUrl: '' },
  { openid: `demo-li-${RUN_ID}`,    nickName: '李叔',   avatarUrl: '' },
  { openid: `demo-wang-${RUN_ID}`,  nickName: '王小明', avatarUrl: '' },
  { openid: `demo-chen-${RUN_ID}`,  nickName: '陈老师', avatarUrl: '' },
  { openid: `demo-zhao-${RUN_ID}`,  nickName: '赵姐',   avatarUrl: '' },
]

function pickUser() {
  return residents[Math.floor(Math.random() * residents.length)]
}

// ---- Helper ----
async function ensureLogin(u) {
  await callAs(u.openid, 'user', 'login', { nickName: u.nickName, avatarUrl: u.avatarUrl })
}

async function join(openid, communityId) {
  const r = await callAs(openid, 'member', 'apply', { communityId })
  if (r.status !== 'active') throw new Error(`join failed for ${openid}: ${JSON.stringify(r)}`)
}

async function post(user, { communityId, sectionId, content }) {
  return callAs(user.openid, 'post', 'create', { communityId, sectionId, content })
}

// ---- Main ----
const creator = residents[0]

console.log(`Seeding demo community (run=${RUN_ID}, creator=${creator.nickName})\n`)

// Register all residents
for (const u of residents) await ensureLogin(u)
console.log(`✓ ${residents.length} residents registered`)

// Community (open-join so real users can walk in)
const { communityId } = await callAs(creator.openid, 'community', 'create', {
  name: `阳光花园社区 [demo-${RUN_ID}]`,
  description: '欢迎来到阳光花园！在这里分享生活、互通信息、邻里互助',
  coverImage: '',
  location: { province: '北京', city: '北京', district: '朝阳区', address: '阳光花园小区' },
  joinType: 'open',
})
await callAdmin('community.approve', { communityId })
console.log(`✓ community created + approved: ${communityId}`)

// All residents join
for (const u of residents.slice(1)) await join(u.openid, communityId)
console.log(`✓ all residents joined`)

// ---- Sections ----

// 1. 闲置交易 — short_text title + summary + number price
const { sectionId: idleId } = await callAdmin('section.create', {
  communityId, name: '闲置交易', icon: '🛍️', order: 1,
})
const { widgets: idleWidgets } = await callAdmin('section.updateWidgets', {
  sectionId: idleId,
  widgets: [
    { type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, widgetId: '' },
    { type: 'summary',    label: '描述', fieldKey: 'desc',  required: true, order: 2, showInList: true, widgetId: '' },
    { type: 'number',     label: '价格', fieldKey: 'price', required: true, order: 3, showInList: true, unit: '元', widgetId: '' },
  ],
})
const idleIds = Object.fromEntries(idleWidgets.map(w => [w.fieldKey, w.widgetId]))
console.log(`✓ section 闲置交易: ${idleId}`)

// 2. 活动公告 — short_text title + datetime + summary
const { sectionId: eventId } = await callAdmin('section.create', {
  communityId, name: '活动公告', icon: '📅', order: 2,
})
const { widgets: eventWidgets } = await callAdmin('section.updateWidgets', {
  sectionId: eventId,
  widgets: [
    { type: 'short_text', label: '活动名称', fieldKey: 'title', required: true, order: 1, showInList: true, widgetId: '' },
    { type: 'datetime',   label: '时间',     fieldKey: 'time',  required: true, order: 2, showInList: true, widgetId: '' },
    { type: 'short_text', label: '地点',     fieldKey: 'place', required: true, order: 3, showInList: true, widgetId: '' },
    { type: 'rich_text',  label: '详情',     fieldKey: 'detail',required: false, order: 4, showInList: false, widgetId: '' },
  ],
})
const eventIds = Object.fromEntries(eventWidgets.map(w => [w.fieldKey, w.widgetId]))
console.log(`✓ section 活动公告: ${eventId}`)

// 3. 失物招领
const { sectionId: lostId } = await callAdmin('section.create', {
  communityId, name: '失物招领', icon: '🔍', order: 3,
})
const { widgets: lostWidgets } = await callAdmin('section.updateWidgets', {
  sectionId: lostId,
  widgets: [
    { type: 'short_text', label: '物品', fieldKey: 'item',    required: true,  order: 1, showInList: true, widgetId: '' },
    { type: 'summary',    label: '描述', fieldKey: 'desc',    required: true,  order: 2, showInList: true, widgetId: '' },
    { type: 'short_text', label: '联系', fieldKey: 'contact', required: false, order: 3, showInList: false, widgetId: '' },
  ],
})
const lostIds = Object.fromEntries(lostWidgets.map(w => [w.fieldKey, w.widgetId]))
console.log(`✓ section 失物招领: ${lostId}`)

// 4. 邻里互助
const { sectionId: helpId } = await callAdmin('section.create', {
  communityId, name: '邻里互助', icon: '🤝', order: 4,
})
const { widgets: helpWidgets } = await callAdmin('section.updateWidgets', {
  sectionId: helpId,
  widgets: [
    { type: 'short_text', label: '需要帮助', fieldKey: 'title', required: true, order: 1, showInList: true, widgetId: '' },
    { type: 'rich_text',  label: '详细说明', fieldKey: 'body',  required: true, order: 2, showInList: false, widgetId: '' },
  ],
})
const helpIds = Object.fromEntries(helpWidgets.map(w => [w.fieldKey, w.widgetId]))
console.log(`✓ section 邻里互助: ${helpId}`)

// ---- Seed posts ----

const idlePosts = [
  { title: '九成新儿童自行车', desc: '孩子长大了骑不动，车况好，前后都有灯，适合4-7岁', price: 150 },
  { title: '全新空气净化器', desc: '买来没怎么用，滤芯还在塑封，搬家处理', price: 400 },
  { title: '实木书桌 + 椅子', desc: '自取，要的私聊。桌面1.2m，没有明显磨损', price: 280 },
  { title: '婴儿推车', desc: '二胎不用了，可躺可坐，五点式安全带', price: 200 },
  { title: '宜家落地灯', desc: '搬家出掉，成色九成新', price: 80 },
]
for (const p of idlePosts) {
  await post(pickUser(), {
    communityId, sectionId: idleId,
    content: { [idleIds.title]: p.title, [idleIds.desc]: p.desc, [idleIds.price]: p.price },
  })
}
console.log(`✓ ${idlePosts.length} 闲置交易 posts`)

const events = [
  { title: '周末亲子烘焙活动', time: '2026-04-20T10:00:00.000Z', place: '1号楼活动室', detail: '适合 3-8 岁小朋友，材料免费，请提前报名。' },
  { title: '社区义诊（内科+儿科）', time: '2026-04-25T09:00:00.000Z', place: '社区服务中心', detail: '医院专家坐诊，免费血压血糖检测' },
  { title: '垃圾分类宣讲会', time: '2026-04-28T19:00:00.000Z', place: '小区广场', detail: '讲解最新分类标准和积分奖励' },
]
for (const e of events) {
  await post(pickUser(), {
    communityId, sectionId: eventId,
    content: { [eventIds.title]: e.title, [eventIds.time]: e.time, [eventIds.place]: e.place, [eventIds.detail]: e.detail },
  })
}
console.log(`✓ ${events.length} 活动公告 posts`)

const lostItems = [
  { item: '灰色钱包', desc: '今天下午在2号楼电梯里捡到，失主看到请联系' },
  { item: '棕色萨摩耶', desc: '昨晚从家里跑出去了，脖子上有蓝色项圈，见到请联系' },
  { item: '黑色车钥匙', desc: '小区北门保安处捡到，请认领' },
]
for (const l of lostItems) {
  await post(pickUser(), {
    communityId, sectionId: lostId,
    content: { [lostIds.item]: l.item, [lostIds.desc]: l.desc },
  })
}
console.log(`✓ ${lostItems.length} 失物招领 posts`)

const helps = [
  { title: '求推荐靠谱的钟点工', body: '家里打扫和做晚饭，一周2-3次，有阿姨推荐吗？' },
  { title: '谁家有儿童故事书闲置', body: '想借给孩子看，看完还回去' },
  { title: '明天有人去菜市场吗', body: '想搭个顺风，分摊停车费' },
  { title: '找一起跳广场舞的邻居', body: '每晚7-8点，在小区广场' },
]
for (const h of helps) {
  await post(pickUser(), {
    communityId, sectionId: helpId,
    content: { [helpIds.title]: h.title, [helpIds.body]: h.body },
  })
}
console.log(`✓ ${helps.length} 邻里互助 posts`)

console.log('\n' + '='.repeat(50))
console.log('🌱 Demo community ready!')
console.log(`\nCommunity ID: ${communityId}`)
console.log(`Sections:`)
console.log(`  闲置交易: ${idleId}`)
console.log(`  活动公告: ${eventId}`)
console.log(`  失物招领: ${lostId}`)
console.log(`  邻里互助: ${helpId}`)
console.log(`\nResidents (test openids):`)
for (const r of residents) console.log(`  ${r.nickName}: ${r.openid}`)
console.log(`\nTotal posts: ${idlePosts.length + events.length + lostItems.length + helps.length}`)
console.log(`\n👉 Open the miniprogram → community list → 阳光花园社区 [demo-${RUN_ID}]`)
console.log(`   Since joinType=open, tap "加入" and you\'re in.`)
