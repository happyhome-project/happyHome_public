import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const componentPath = path.resolve(__dirname, '../../components/DefaultDetailView.vue')

describe('reusable topic rendering', () => {
  test('default post details render topic widgets as hashtag chips', () => {
    const source = fs.readFileSync(componentPath, 'utf8')
    expect(source).toContain("widget.type === 'topic'")
    expect(source).toContain('class="topic-chip"')
    expect(source).toContain('#{{ topic }}')
  })
})
