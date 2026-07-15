import assert from 'node:assert/strict'
import test from 'node:test'

import { projectLegacyArchivePost } from './archive-legacy-projection.mjs'

const section = {
  _id: 'section-guide',
  type: 'evergreen',
  widgets: [
    { widgetId: 'guide_title', fieldKey: 'title', type: 'short_text' },
    { widgetId: 'guide_images', fieldKey: 'images', type: 'image_group' },
    { widgetId: 'guide_body', fieldKey: 'body', type: 'rich_note' },
    { widgetId: 'guide_location', fieldKey: 'location', type: 'location' },
  ],
}

test('projects legacy widget fields into the canonical image-text archive contract', () => {
  const post = {
    _id: 'post-guide',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: section._id,
    content: {
      guide_title: '周末森林路线',
      guide_images: ['cloud://one', '', 'cloud://two'],
      guide_body: { format: 'rich', text: '路线正文' },
      guide_location: { name: '森林公园', lat: 30, lng: 104 },
      guide_distance: '8km',
    },
  }

  const result = projectLegacyArchivePost(post, section)

  assert.equal(result.changed, true)
  assert.equal(result.after.format, 'image_text')
  assert.equal(result.after.content.title, '周末森林路线')
  assert.deepEqual(result.after.content.images, ['cloud://one', 'cloud://two'])
  assert.deepEqual(result.after.content.body, post.content.guide_body)
  assert.deepEqual(result.after.content.location, post.content.guide_location)
  assert.equal(result.after.content.guide_distance, '8km')
  assert.equal(result.after.sectionId, section._id)
})

test('preserves newer canonical fields and is idempotent', () => {
  const post = {
    _id: 'post-canonical',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: section._id,
    format: 'image_text',
    content: {
      title: '管理员新标题',
      images: ['cloud://canonical'],
      body: { text: '新正文' },
      guide_title: '旧标题',
      guide_images: ['cloud://legacy'],
      guide_body: { text: '旧正文' },
    },
  }

  const result = projectLegacyArchivePost(post, section)

  assert.equal(result.changed, false)
  assert.equal(result.after.content.title, '管理员新标题')
  assert.deepEqual(result.after.content.images, ['cloud://canonical'])
  assert.deepEqual(result.after.content.body, { text: '新正文' })
})

test('projects image-less legacy content as a text archive post', () => {
  const post = {
    _id: 'post-text',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: section._id,
    content: { guide_title: '纯文字记录', guide_body: { text: '正文' } },
  }

  const result = projectLegacyArchivePost(post, section)

  assert.equal(result.changed, true)
  assert.equal(result.after.format, 'text')
  assert.equal(result.after.content.title, '纯文字记录')
  assert.deepEqual(result.after.content.images, [])
})

test('corrects a stale text format when legacy widgets contain images', () => {
  const post = {
    _id: 'post-stale-format',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: section._id,
    format: 'text',
    content: { guide_title: '有图旧帖', guide_images: ['cloud://cover'] },
  }

  const result = projectLegacyArchivePost(post, section)

  assert.equal(result.changed, true)
  assert.equal(result.after.format, 'image_text')
})

test('rejects posts outside the deterministic legacy archive scope', () => {
  assert.equal(projectLegacyArchivePost({ area: 'archive', origin: 'native' }, section), null)
  assert.equal(projectLegacyArchivePost({ area: 'archive', origin: 'legacy_section' }, { ...section, type: 'realtime' }), null)
})

test('projects arbitrary legacy widget ids by semantic labels and widget types', () => {
  const semanticSection = {
    _id: 'section-semantic',
    type: 'evergreen',
    widgets: [
      { widgetId: 'random_heading', type: 'summary', label: '标题' },
      { widgetId: 'random_gallery', type: 'image_group', label: '照片' },
      { widgetId: 'random_note', type: 'rich_note', label: '详细内容' },
      { widgetId: 'random_place', type: 'location', label: '地点' },
    ],
  }
  const post = {
    _id: 'post-semantic',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: semanticSection._id,
    content: {
      random_heading: '河畔亲子路线',
      random_gallery: ['cloud://river'],
      random_note: { text: '适合四岁以上儿童' },
      random_place: { name: '河畔公园' },
    },
  }

  const result = projectLegacyArchivePost(post, semanticSection)

  assert.equal(result.after.content.title, '河畔亲子路线')
  assert.deepEqual(result.after.content.images, ['cloud://river'])
  assert.deepEqual(result.after.content.body, { text: '适合四岁以上儿童' })
  assert.deepEqual(result.after.content.location, { name: '河畔公园' })
  assert.equal(result.after.format, 'image_text')
})

test('derives a bounded title from body-only rich text while preserving the original body', () => {
  const bodySection = {
    _id: 'section-body',
    type: 'evergreen',
    widgets: [{ widgetId: 'complete_material', fieldKey: 'content', type: 'rich_text', label: '完整资料' }],
  }
  const body = { html: '<p>第一行完整资料</p><p>第二行补充说明</p>' }
  const post = {
    _id: 'post-body',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: bodySection._id,
    content: { complete_material: body },
  }

  const result = projectLegacyArchivePost(post, bodySection)

  assert.equal(result.after.content.title, '第一行完整资料 第二行补充说明')
  assert.deepEqual(result.after.content.body, body)
  assert.equal(result.after.format, 'text')
})

test('does not manufacture empty canonical fields when no legacy widget has displayable content', () => {
  const emptySection = {
    _id: 'section-empty',
    type: 'evergreen',
    widgets: [{ widgetId: 'empty_gallery', type: 'image_group', label: '照片' }],
  }
  const post = {
    _id: 'post-empty',
    area: 'archive',
    origin: 'legacy_section',
    sectionId: emptySection._id,
    content: { empty_gallery: [] },
  }

  assert.equal(projectLegacyArchivePost(post, emptySection), null)
})
