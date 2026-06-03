import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readSource(relativePath: string) {
  return readFileSync(resolve(srcRoot, relativePath), 'utf-8')
}

describe('profile approval reminder UI contract', () => {
  test('uses a contextual approval reminder card instead of the old persistent admin reminder block', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).toContain('approval-reminder-card')
    expect(code).toContain('approvalReminderState.kind')
    expect(code).not.toContain('管理员提醒')
    expect(code).not.toContain('接收审批提醒')
    expect(code).not.toContain('VITE_APPROVAL_MEMBER_JOIN_TEMPLATE_ID')
    expect(code).not.toContain('VITE_APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID')
  })
})
