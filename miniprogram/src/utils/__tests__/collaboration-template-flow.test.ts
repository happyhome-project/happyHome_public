import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const homeSource = readFileSync('src/pages/index/index.vue', 'utf8')
const createSource = readFileSync('src/pages/create/index.vue', 'utf8')
const detailSource = readFileSync('src/pages/detail/index.vue', 'utf8')
const myPostsSource = readFileSync('src/pages/my-posts/index.vue', 'utf8')

describe('global collaboration template mini-program flow', () => {
  test('home renders collaboration posts from the global-template snapshot fields', () => {
    expect(homeSource).toContain('collaborationTemplates')
    expect(homeSource).toContain('collaborationPostsByTemplate')
    expect(homeSource).toContain('asCollaborationSection')
    expect(homeSource).toContain('communityStore.setActiveCommunities(')
    expect(homeSource).toContain('communityStore.setCollaborationTemplates(safeSnapshot.collaborationTemplates || [])')
  })

  test('the collaboration picker loads global templates and creates a section-free post', () => {
    expect(createSource).toContain('collaborationTemplateApi.listActive()')
    expect(createSource).toContain('asCollaborationSection')
    expect(createSource).toContain('postApi.createCollaboration')
    expect(createSource).toContain('collaborationTemplateId: selectedSection.value.collaborationTemplateId')
    expect(createSource).toContain('communityStore.collaborationTemplates')
    expect(createSource).toContain('communityStore.setCollaborationTemplates(')
  })

  test('publishing consumes session membership without a blocking page-level recheck', () => {
    expect(createSource).not.toContain('检查社区成员身份中')
    expect(createSource).not.toContain('memberApi.myStatus(')
    expect(createSource).not.toContain('checkMembership(')
    expect(createSource).toContain('communityStore.getMembershipStatus(')
    expect(createSource).toContain('communityStore.myCommunities.some(')
  })

  test('the collaboration picker keeps unresolved templates in a loading state', () => {
    expect(createSource).toContain('v-else-if="!activeSectionsReady"')
    expect(createSource).toContain('!collaborationOnly.value || communityStore.collaborationTemplatesReady')
    expect(createSource).toContain('v-if="activeSectionsReady && activeSections.length === 0"')
    expect(createSource).toContain('if (collaborationTemplatesLoad) return collaborationTemplatesLoad')
    expect(createSource).toContain('if (editPostId.value || initialLoadPending.value) return')
    expect(createSource).toContain('协作类型加载失败')
    expect(createSource).toContain('@tap="retryCollaborationTemplates"')
  })

  test('the collaboration route mode is resolved before edit loading can yield to onShow', () => {
    expect(createSource.indexOf("collaborationOnly.value = String(options?.mode || '') === 'collaboration'"))
      .toBeLessThan(createSource.indexOf("await loadPostForEdit(String(options?.editPostId || ''))"))
  })

  test('detail and edit resolve the global template returned with a collaboration post', () => {
    expect(detailSource).toContain('res?.collaborationTemplate')
    expect(detailSource).toContain('asCollaborationSection')
    expect(createSource).toContain('response?.collaborationTemplate')
  })

  test('my-posts empty action enters the fixed collaboration picker', () => {
    expect(myPostsSource).toContain('/pages/create/index?mode=collaboration')
  })
})
