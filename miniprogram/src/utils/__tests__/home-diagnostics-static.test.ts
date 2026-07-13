import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const srcRoot = path.resolve(__dirname, '..', '..')
const readSource = (...parts: string[]) => fs.readFileSync(path.join(srcRoot, ...parts), 'utf8')

describe('Home diagnostics integration', () => {
  test('loads the Home entry probe before Home-only utility dependencies', () => {
    const home = readSource('pages', 'index', 'index.vue')
    const probeIndex = home.indexOf("import '../../utils/home-entry-probe'")
    const iconIndex = home.indexOf("import { resolveSectionIconGlyph } from '../../utils/section-icon'")

    expect(probeIndex).toBeGreaterThan(-1)
    expect(iconIndex).toBeGreaterThan(-1)
    expect(probeIndex).toBeLessThan(iconIndex)
  })

  test('records setup, render, and mounted failure boundaries', () => {
    const home = readSource('pages', 'index', 'index.vue')

    expect(home).toContain("markClientDiagnosticStage('home.setup.enter'")
    expect(home).toContain("'home.render.commit'")
    expect(home).toContain("'home.render.incomplete'")
    expect(home).toContain("clientLog('error', 'home.mounted.fail'")
  })

  test('exposes Profile Home diagnostics only after explicit local opt-in in develop or trial', () => {
    const profile = readSource('pages', 'profile', 'index.vue')

    expect(profile).toContain('Home 诊断')
    expect(profile).toContain('enableClientDiagnostics')
    expect(profile).toContain('flushClientDiagnostics')
    expect(profile).toContain("uni.getStorageSync('hh-profile-developer-tools') === '1'")
    expect(profile).toContain("envVersion === 'develop' || envVersion === 'trial'")
    expect(profile).toMatch(/v-if="developerToolsEnabled && !isEditingProfile && !showManualLoginForm"[^>]*class="profile-diagnostics"/)
  })
})
