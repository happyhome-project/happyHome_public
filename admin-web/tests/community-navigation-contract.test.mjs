import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('layout renders active communities as a multi-expand navigation tree', () => {
  const source = read('src/views/Layout.vue')
  assert.match(source, /useCommunityNavigationStore/)
  assert.match(source, /community-navigation-tree/)
  assert.match(source, /toggleCommunity/)
  assert.match(source, /suppressAutoExpandCommunityId/)
  assert.match(source, /name:\s*'posts'/)
  assert.match(source, /板块管理[\s\S]*帖子管理[\s\S]*沉淀区话题[\s\S]*成员管理[\s\S]*社区设置/)
})

test('content audit follows approval and system management is collapsible', () => {
  const source = read('src/views/Layout.vue')
  assert.ok(source.indexOf('menu-content-audit') > source.indexOf('menu-approval'))
  assert.match(source, /system-management-toggle/)
  assert.match(source, /toggleSystemManagement/)
})

test('router provides stable keyed community views and settings route', () => {
  const source = read('src/router/index.ts')
  const layout = read('src/views/Layout.vue')
  assert.match(source, /community-settings\/:communityId/)
  assert.match(source, /name:\s*'community-settings'/)
  assert.match(layout, /routeViewKey/)
  assert.match(layout, /<component\s+:is="Component"\s+:key="routeViewKey"/)
})

test('community overview omits duplicate module shortcuts', () => {
  const source = read('src/views/CommunityAdmin/CommunityList.vue')
  assert.doesNotMatch(source, /community-sections-button/)
  assert.doesNotMatch(source, /community-members-button/)
  assert.doesNotMatch(source, /community-motto-button/)
  assert.doesNotMatch(source, /community-banner-button/)
  assert.match(source, /useCommunityNavigationStore/)
  assert.match(source, /navigation\.refresh/)
})

test('community module pages rely on tree navigation instead of overview back buttons', () => {
  for (const file of ['SectionList.vue', 'PostManagement.vue', 'MemberApproval.vue']) {
    const source = read(`src/views/CommunityAdmin/${file}`)
    assert.doesNotMatch(source, /title="返回社区管理"/)
  }
})

test('community settings manages profile, home presentation and join type', () => {
  const source = read('src/views/CommunityAdmin/CommunitySettings.vue')
  assert.match(source, /基本资料/)
  assert.match(source, /首页展示/)
  assert.match(source, /加入方式/)
  assert.match(source, /updateMeta/)
  assert.match(source, /updateHomeBanners/)
})

test('member approval exposes inline approve and reject actions', () => {
  const source = read('src/views/CommunityAdmin/MemberApproval.vue')
  assert.match(source, /member-approve-button/)
  assert.match(source, /member-reject-button/)
})

test('successful approvals invalidate layout badge state without a route change', () => {
  const layout = read('src/views/Layout.vue')
  assert.match(layout, /@approval-changed="refreshNavigation"/)

  for (const file of ['CommunityAdmin/MemberApproval.vue', 'SuperAdmin/CommunityApproval.vue']) {
    const source = read(`src/views/${file}`)
    assert.match(source, /defineEmits/)
    assert.ok(
      (source.match(/emit\('approval-changed'\)/g) || []).length >= 2,
      `${file} should refresh badges after both approve and reject`,
    )
  }
})

test('post management exposes existing operations inline', () => {
  const source = read('src/views/CommunityAdmin/PostManagement.vue')
  for (const label of ['详情', '置顶', '加精', '编辑', '删除']) assert.match(source, new RegExp(label))
})
