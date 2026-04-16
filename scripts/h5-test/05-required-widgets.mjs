// Scenario 5: post creation validates required widgets from section config.

import { callAs, callAdmin, createAsserter, makeRunId, seedApprovedCommunity } from './_shared.mjs'

const { assert, expectReject, finish } = createAsserter('required-widgets')
const runId = makeRunId()
const { communityId, sectionId, widgetId } = await seedApprovedCommunity(runId)

// Add a second required widget to the section
const widgetsRes = await callAdmin('section.updateWidgets', {
  sectionId,
  widgets: [
    { type: 'text', label: '内容', required: true, showInList: true, widgetId },
    { type: 'text', label: '价格', required: true, showInList: false, widgetId: '' },
  ],
})
const priceWidgetId = widgetsRes.widgets.find((w) => w.label === '价格').widgetId
assert(!!priceWidgetId, 'second required widget added')

const author = `scene-req-${runId}`
await callAs(author, 'user', 'login', { nickName: 'ReqAuthor', avatarUrl: '' })
await callAs(author, 'member', 'apply', { communityId })

console.log(`Scenario: required widgets`)

// Missing one required widget — rejected
await expectReject(
  () => callAs(author, 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'only content, no price' },
  }),
  'post rejected when required "价格" missing',
)

// Empty string in required — rejected
await expectReject(
  () => callAs(author, 'post', 'create', {
    communityId, sectionId, content: { [widgetId]: 'content', [priceWidgetId]: '' },
  }),
  'post rejected when required field is empty string',
)

// All required filled — accepted
const ok = await callAs(author, 'post', 'create', {
  communityId, sectionId, content: { [widgetId]: 'content', [priceWidgetId]: '99' },
})
assert(!!ok.postId, 'post created when all required fields filled')

finish()
