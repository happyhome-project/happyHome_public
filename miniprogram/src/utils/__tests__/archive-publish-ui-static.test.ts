import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

describe('archive publishing entry', () => {
  test('keeps archive topic navigation on the shared page background', () => {
    const source = read('components', 'ArchiveTopicTabs.vue')
    const rule = source.match(/\.archive-topic-tabs\s*\{([^}]*)\}/s)?.[1] || ''
    expect(rule).not.toMatch(/(?:^|\s)background\s*:/)
  })

  test('offers exactly the three product-level publishing choices', () => {
    const source = read('components', 'AppTabBar.vue')
    expect(source).toContain("{ key: 'image_text', label: '发图文'")
    expect(source).toContain("{ key: 'text', label: '写文字'")
    expect(source).toContain("{ key: 'collaboration', label: '发起协作'")
    expect(source).not.toContain('activePublishSections')
    expect(source).not.toContain('option.section')
  })

  test('keeps the publish button free of a tinted outer shadow', () => {
    const source = read('components', 'AppTabBar.vue')
    const pillRule = source.match(/\.fab-pill\s*\{([^}]*)\}/s)?.[1] || ''

    expect(pillRule).not.toMatch(/box-shadow\s*:/)
  })

  test('archive editors submit without a section while collaboration filters realtime sections', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('postApi.createArchive({')
    expect(create).toContain("area: 'archive'")
    expect(create).toContain("section?.type === 'realtime'")
  })

  test('enters an archive editor before the first asynchronous create-page load', () => {
    const create = read('pages', 'create', 'index.vue')
    const onLoadStart = create.indexOf('onLoad(async (options: any) => {')
    const firstAwait = create.indexOf('await ensureSectionsLoaded()', onLoadStart)
    const archiveEditor = create.indexOf('enterArchiveEditor(requestedArchiveFormat', onLoadStart)

    expect(onLoadStart).toBeGreaterThanOrEqual(0)
    expect(archiveEditor).toBeGreaterThan(onLoadStart)
    expect(archiveEditor).toBeLessThan(firstAwait)
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
