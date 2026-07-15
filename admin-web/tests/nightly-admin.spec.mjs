import { test, expect } from '@playwright/test'
import { callAdmin, callAs, createCleanupRegistry, makeRunId } from '../../scripts/lib/test-api.mjs'

const cleanupRegistry = createCleanupRegistry()
const state = {}

function usernameValue() {
  return process.env.VITE_ADMIN_USERNAME || ''
}

function passwordValue() {
  return process.env.VITE_ADMIN_PASSWORD || ''
}

async function fillInput(container, value) {
  await container.locator('input').fill(value)
}

async function switchToPasswordLogin(page) {
  const switchButton = page.getByTestId('login-switch-password')
  if (await switchButton.isVisible().catch(() => false)) {
    await switchButton.click()
  }
  await expect(page.getByTestId('login-form')).toBeVisible()
}

async function login(page) {
  if (!usernameValue() || !passwordValue()) {
    throw new Error('VITE_ADMIN_USERNAME and VITE_ADMIN_PASSWORD are required for nightly admin UI login')
  }

  await page.goto('/login')
  await switchToPasswordLogin(page)
  await fillInput(page.getByTestId('login-username-field'), usernameValue())
  await fillInput(page.getByTestId('login-password-field'), passwordValue())
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/approval$/)
}

test.beforeAll(async () => {
  const runId = makeRunId()
  state.owner = `admin-ui-owner-${runId}`
  state.applicant = `admin-ui-applicant-${runId}`

  await callAs(state.owner, 'user', 'login', { nickName: 'AdminUiOwner', avatarUrl: '' })
  await callAs(state.applicant, 'user', 'login', { nickName: 'AdminUiApplicant', avatarUrl: '' })

  const { communityId } = await callAs(state.owner, 'community', 'create', {
    name: `AdminUi-${runId}`,
    description: 'seeded by Playwright nightly',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'approval',
  })
  cleanupRegistry.trackCommunity(communityId)
  state.communityId = communityId

  await callAdmin('community.approve', { communityId })
  const { sectionId } = await callAdmin('section.create', {
    communityId,
    name: `Playwright-${runId}`,
    icon: 'book',
    order: 0,
    type: 'evergreen',
  })
  state.sectionId = sectionId

  await callAdmin('section.updateWidgets', {
    sectionId,
    communityId,
    widgets: [{ type: 'short_text', label: '内容', fieldKey: 'title', required: true, showInList: true, widgetId: '' }],
  })

  await callAs(state.applicant, 'member', 'apply', { communityId })
})

test.afterAll(async () => {
  const cleanup = await cleanupRegistry.cleanupAll(console)
  if (!cleanup.ok) {
    throw new Error(`Playwright cleanup failed: ${cleanup.issues.map((x) => `${x.communityId}: ${x.message}`).join('; ')}`)
  }
})

test('invalid login stays on login page', async ({ page }) => {
  await page.goto('/login')
  await switchToPasswordLogin(page)
  await fillInput(page.getByTestId('login-username-field'), 'wrong-user')
  await fillInput(page.getByTestId('login-password-field'), 'wrong-password')
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('.el-message')).toHaveCount(1)
})

test('successful login lands on approval page', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(/\/approval$/)
  await expect(page.getByTestId('layout-shell')).toBeVisible()
  await expect(page.getByTestId('approval-center-page')).toBeVisible()
})

test('community list can navigate to section page', async ({ page }) => {
  await login(page)
  await page.goto('/communities')

  const sectionsButton = page.locator(`[data-testid="community-sections-button"][data-community-id="${state.communityId}"]`).first()
  await expect(page.getByTestId('community-list-page')).toBeVisible()
  await expect(page.getByTestId('community-table')).toBeVisible()
  await expect(sectionsButton).toBeVisible()
  await sectionsButton.click()

  await expect(page).toHaveURL(new RegExp(`/sections/${state.communityId}`))
  await expect(page.getByTestId('section-list-page')).toBeVisible()
  await expect(page.getByTestId('section-table')).toBeVisible()
})

test('community list can navigate to members page and show pending member', async ({ page }) => {
  await login(page)
  await page.goto('/communities')

  const membersButton = page.locator(`[data-testid="community-members-button"][data-community-id="${state.communityId}"]`).first()
  await expect(membersButton).toBeVisible()
  await membersButton.click()

  await expect(page).toHaveURL(new RegExp(`/members/${state.communityId}`))
  await expect(page.getByTestId('member-approval-page')).toBeVisible()
  await expect(page.getByTestId('member-pending-table')).toBeVisible()
  await expect(page.getByTestId('member-pending-table').locator('text=AdminUiApplicant').first()).toBeVisible()
})
