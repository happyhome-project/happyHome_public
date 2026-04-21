import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './admin-web/tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'artifacts/playwright-report' }],
  ],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'artifacts/playwright-artifacts',
  use: {
    baseURL: process.env.ADMIN_WEB_BASE_URL || 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
})
