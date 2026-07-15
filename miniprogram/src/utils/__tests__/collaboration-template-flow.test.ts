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
  })

  test('the collaboration picker loads global templates and creates a section-free post', () => {
    expect(createSource).toContain('collaborationTemplateApi.listActive()')
    expect(createSource).toContain('asCollaborationSection')
    expect(createSource).toContain('postApi.createCollaboration')
    expect(createSource).toContain('collaborationTemplateId: selectedSection.value.collaborationTemplateId')
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
