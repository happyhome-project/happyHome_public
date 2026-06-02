import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve('miniprogram/src/pages/profile/index.vue')
const source = readFileSync(sourcePath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(
  source.includes('data-testid="profile-feedback-contact-card"'),
  'profile page should render a stable feedback contact card',
)
assert(
  source.includes('open-type="contact"'),
  'feedback action should use WeChat native customer service contact entry',
)
assert(
  source.includes('show-message-card'),
  'feedback contact should send a message card for context',
)
assert(
  source.includes('send-message-title="HappyHome \u4f7f\u7528\u53cd\u9988"'),
  'feedback contact should use a clear message card title',
)
assert(
  source.includes('send-message-path="/pages/profile/index"'),
  'feedback contact message card should point back to the profile page',
)
assert(
  source.includes('\u7559\u8a00\u53cd\u9988'),
  'feedback contact button should use the agreed user-facing label',
)

console.log('[miniprogram-feedback-contact-static] ok')
