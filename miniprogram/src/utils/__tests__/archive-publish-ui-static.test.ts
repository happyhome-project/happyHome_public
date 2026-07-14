import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

describe('archive publishing entry', () => {
  test('offers exactly the three product-level publishing choices', () => {
    const source = read('components', 'AppTabBar.vue')
    expect(source).toContain("{ key: 'image_text', label: '发图文'")
    expect(source).toContain("{ key: 'text', label: '写文字'")
    expect(source).toContain("{ key: 'collaboration', label: '发起协作'")
    expect(source).not.toContain('activePublishSections')
    expect(source).not.toContain('option.section')
  })

  test('archive editors submit without a section while collaboration filters realtime sections', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('postApi.createArchive({')
    expect(create).toContain("area: 'archive'")
    expect(create).toContain("section?.type === 'realtime'")
  })

  test('native archive detail builds a virtual renderer while legacy section posts keep section loading', () => {
    const detail = read('pages', 'detail', 'index.vue')
    expect(detail).toContain("post.value?.area === 'archive' && !post.value?.sectionId")
    expect(detail).toContain('buildNativeArchiveDetailSection')
    expect(detail).toContain('image_note_images: content.images')
    expect(detail).toContain('image_note_topics: currentPost.topics || []')
    expect(detail).toContain("sectionApi.get(post.value.sectionId")
  })

  test('topic switching invalidates stale archive requests', () => {
    const home = read('pages', 'index', 'index.vue')
    expect(home).toContain('const requestEpoch = ++archiveRequestEpoch')
    expect(home).toContain('requestEpoch !== archiveRequestEpoch')
  })
})
