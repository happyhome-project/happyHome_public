import { describe, expect, test } from 'vitest'
import {
  asCollaborationSection,
  isCollaborationSection,
} from '../collaboration-template'

const template = {
  _id: 'collaboration-template-carpool',
  systemKey: 'carpool',
  name: '拼车出行',
  icon: '🚗',
  order: 0,
  status: 'active',
  enableComment: true,
  enableLike: true,
  widgets: [{ widgetId: 'carpool_note', type: 'note_blocks', label: '补充说明', required: false, order: 4 }],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

describe('collaboration template client contract', () => {
  test('adapts a global template to the existing section-shaped renderer without creating a section id', () => {
    const section = asCollaborationSection(template, 'community-1')

    expect(section).toMatchObject({
      _id: template._id,
      collaborationTemplateId: template._id,
      communityId: 'community-1',
      name: '拼车出行',
      type: 'realtime',
      status: 'active',
      isCollaborationTemplate: true,
    })
    expect(isCollaborationSection(section)).toBe(true)
    expect(section.sectionId).toBeUndefined()
  })

  test('does not mistake a legacy realtime section for a global collaboration template', () => {
    expect(isCollaborationSection({ _id: 'legacy-section', type: 'realtime' })).toBe(false)
  })
})
