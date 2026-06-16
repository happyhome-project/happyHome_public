import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const componentRoot = path.resolve(__dirname, '../../components')

function readComponent(relativePath: string): string {
  return fs.readFileSync(path.join(componentRoot, relativePath), 'utf8')
}

describe('location map rendering', () => {
  test('default detail view renders real map thumbnails for location widgets', () => {
    const source = readComponent('DefaultDetailView.vue')

    expect(source).toContain('<map')
    expect(source).toContain(':latitude="item.lat"')
    expect(source).toContain(':longitude="item.lng"')
    expect(source).not.toContain('class="map-surface"')
  })

  test('generic widget renderer renders real map thumbnails for location widgets', () => {
    const source = readComponent('widgets/WidgetRenderer.vue')

    expect(source).toContain('<map')
    expect(source).toContain(':latitude="locationPreview.lat"')
    expect(source).toContain(':longitude="locationPreview.lng"')
  })
})
