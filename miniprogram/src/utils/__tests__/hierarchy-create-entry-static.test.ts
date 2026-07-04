import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = join(process.cwd(), 'src')

function read(...parts: string[]) {
  return readFileSync(join(root, ...parts), 'utf8')
}

describe('create page hierarchy entry', () => {
  test('create is not a native tab page so phone back can return to the previous page', () => {
    const pagesJson = read('pages.json')
    const appTabBar = read('components', 'AppTabBar.vue')
    const sectionPage = read('pages', 'section', 'index.vue')
    const detailPage = read('pages', 'detail', 'index.vue')

    expect(pagesJson).not.toContain('"pagePath": "pages/create/index"')
    expect(appTabBar).not.toContain("uni.switchTab({ url: '/pages/create/index' })")
    expect(sectionPage).not.toContain("uni.switchTab({\n    url: '/pages/create/index'")
    expect(detailPage).not.toContain("uni.switchTab({ url: '/pages/create/index' })")
  })

  test('all non-tab entry pages rebuild a parent stack when opened directly', () => {
    const pages = [
      ['pages', 'admin-login', 'index.vue'],
      ['pages', 'create', 'index.vue'],
      ['pages', 'createCommunity', 'index.vue'],
      ['pages', 'detail', 'index.vue'],
      ['pages', 'notice', 'index.vue'],
      ['pages', 'onboarding', 'index.vue'],
      ['pages', 'search', 'index.vue'],
      ['pages', 'section', 'index.vue'],
      ['pages', 'web-view', 'index.vue'],
    ]

    pages.forEach((parts) => {
      const source = read(...parts)
      const route = `/${parts.slice(0, 2).join('/')}/index`
      expect(source).toContain('ensureHierarchyStack')
      expect(source).toContain(`ensureHierarchyStack('${route}'`)
    })
  })
})
