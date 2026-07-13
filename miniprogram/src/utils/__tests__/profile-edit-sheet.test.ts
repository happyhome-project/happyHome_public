import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')
const template = source.slice(source.indexOf('<template>'), source.indexOf('<script setup'))

describe('profile edit bottom sheet', () => {
  test('keeps the logged-in profile shell mounted while editing', () => {
    expect(template).toContain('v-if="userStore.isLoggedIn"')
    expect(template).not.toContain('userStore.isLoggedIn && !isEditingProfile')
    expect(template).toMatch(/v-if="!showManualLoginForm" class="profile-shortcuts"/)
    expect(template).toMatch(/v-if="!showManualLoginForm" class="profile-tools-card"/)
    expect(template).toMatch(/<AppTabBar current="profile" \/>/)
  })

  test('renders editing in a dismissible fixed bottom sheet above the tab bar', () => {
    expect(template).toMatch(/v-if="isEditingProfile"\s+class="profile-edit-mask"\s+@tap="cancelEditProfile"/)
    expect(template).toMatch(/class="profile-edit-sheet"[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="profile-edit-sheet-title"/)
    expect(template).toContain('id="profile-edit-sheet-title" class="profile-edit-sheet__title">编辑资料')
    expect(template).toContain('open-type="chooseAvatar"')
    expect(template).toContain('class="profile-edit-sheet__label">昵称')
    expect(template).toMatch(/type="nickname"[\s\S]*aria-label="昵称"/)
    expect(template).toContain("当前基础库暂不支持修改头像")
    expect(template).toMatch(/profile-edit-sheet__cancel"[\s\S]*:disabled="submitFormLock\.busy\.value"[\s\S]*@tap="cancelEditProfile"/)
    expect(template).toMatch(/@tap="saveProfile"[\s\S]*保存中\.\.\./)

    expect(source).toMatch(/\.profile-edit-mask\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*z-index:\s*\$hh-z-modal;/)
    expect(source).toMatch(/\.profile-edit-mask\s*\{[\s\S]*background:\s*rgba\(0, 0, 0, 0\.55\);/)
    expect(source).toMatch(/\.profile-edit-sheet\s*\{[\s\S]*border-radius:\s*32rpx 32rpx 0 0;[\s\S]*padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/)
  })

  test('keeps manual login in the user card and reuses the profile edit actions', () => {
    const userCard = template.slice(template.indexOf('<view class="user-card"'), template.indexOf('<view v-if="developerToolsEnabled'))
    expect(userCard).toContain('v-else-if="showManualLoginForm"')
    expect(userCard).not.toContain('v-else-if="isEditingProfile"')
    expect(source).toContain('function startEditProfile()')
    expect(source).toContain('function cancelEditProfile()')
    expect(source).toContain('function saveProfile()')
    expect(source).toContain('uploadAvatarIfAny(submittedAvatarTempPath, submittedAvatarCloudUrl, wasEditingProfile)')
  })

  test('makes the H5 background inert and leaves initial focus inside the dialog', () => {
    expect(template).toMatch(/class="profile-page-background"[\s\S]*:inert="isEditingProfile"[\s\S]*:aria-hidden="isEditingProfile \? 'true' : undefined"/)
    expect(template.indexOf('class="profile-page-background"')).toBeLessThan(template.indexOf('class="profile-edit-mask"'))
    expect(template).toMatch(/type="nickname"[\s\S]*:focus="isEditingProfile"/)
  })
})
