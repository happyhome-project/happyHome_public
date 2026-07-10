import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const srcRoot = path.resolve(process.cwd(), 'src')
const readPage = (page: string) => fs.readFileSync(path.join(srcRoot, 'pages', page, 'index.vue'), 'utf8')

describe('Figma community directory pages', () => {
  test('join page renders real community avatars, one-line copy, and joined/join actions', () => {
    const code = readPage('onboarding')

    expect(code).toContain(':src="communityAvatar(community)"')
    expect(code).toContain("if (community.viewerStatus === 'active') return '已加入'")
    expect(code).toContain("return '我要加入'")
    expect(code).toContain('text-overflow: ellipsis')
    expect(code).toContain('white-space: nowrap')
    expect(code).toContain('communityActionBusy')
    expect(code).toContain('.status.joined')
    expect(code).toContain('env(safe-area-inset-bottom)')
  })

  test('switch page follows the same directory row contract instead of a separate hero layout', () => {
    const code = readPage('community-switch')

    expect(code).toContain('请选择你的社区')
    expect(code).toContain(':src="communityAvatar(community)"')
    expect(code).toContain("return '已加入'")
    expect(code).toContain("return '我要加入'")
    expect(code).not.toContain('switch-hero')
    expect(code).toContain('communityActionBusy')
    expect(code).toContain('.community-status.joined')
    expect(code).toContain('env(safe-area-inset-bottom)')
  })

  test('create page uses three independent modules and a bottom action area', () => {
    const code = readPage('createCommunity')

    expect(code.match(/class="form-section/g)).toHaveLength(3)
    expect(code).toContain('class="bottom-action"')
    expect(code).toContain('position: fixed')
    expect(code).toContain('background: #f2f3f7')
    expect(code).toContain('font-weight: $hh-font-weight-bold')
    expect(code).toContain('if (submitting.value) return')
    expect(code).toContain('role="radiogroup"')
    expect(code).toContain(':aria-checked=')
    expect(code).toContain('env(safe-area-inset-bottom)')
  })

  test('home rejects a cached snapshot whose current community is not active', () => {
    const code = readPage('index')

    expect(code).toContain("filter((community) => community?.status === 'active')")
    expect(code).toContain('userStore.isLoggedIn && snapshot.currentCommunityId && !activeCommunities.some')
    expect(code).toContain('const acceptedSnapshot = applyHomeSnapshot')
    expect(code).toContain('if (!acceptedSnapshot)')
  })
})
