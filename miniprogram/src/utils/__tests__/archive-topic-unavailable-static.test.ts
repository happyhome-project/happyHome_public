import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('archive topic fallback', () => {
  test('switches to All without clearing the visible feed when the selected topic was deleted', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
    expect(source).toContain('result.topicUnavailable')
    expect(source).toMatch(/nextArchiveTopic\s*=\s*['"]['"]/)
    expect(source).toMatch(/result\s*=\s*await postApi\.listArchive/)
    expect(source).toContain('if (!reset) return loadArchiveFeed(true, { preserveVisible: true })')
  })
})
