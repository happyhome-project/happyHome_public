import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('archive topic fallback', () => {
  test('switches to All and reloads when the selected topic was deleted', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')
    expect(source).toContain('result.topicUnavailable')
    expect(source).toMatch(/selectedArchiveTopic\.value\s*=\s*['"]['"]/)
    expect(source).toContain('return loadArchiveFeed(true)')
  })
})
