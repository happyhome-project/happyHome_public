import { describe, expect, test } from 'vitest'
import { getListPreview } from '../widget'
import type { Post, Section } from '../../../../cloud/shared/types'

describe('note_blocks list preview', () => {
  test('does not render note blocks in list preview even when showInList is true', () => {
    const section: Section = {
      _id: 's-note',
      communityId: 'c-note',
      name: 'Notes',
      icon: 'book',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2026-01-01',
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'w-title', type: 'short_text', label: 'Title', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'w-note', type: 'note_blocks', label: 'Note', fieldKey: 'note', required: false, order: 1, showInList: true },
      ],
    }

    const post: Post = {
      _id: 'p-note',
      communityId: 'c-note',
      sectionId: 's-note',
      authorId: 'u-note',
      status: 'active',
      content: {
        'w-title': 'weekly reading',
        'w-note': [
          { blockId: 'b-text', type: 'text', text: 'hello' },
          { blockId: 'b-image', type: 'image', fileID: 'cloud://env/images/1.jpg' },
        ],
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    expect(getListPreview(post, section)).toEqual([
      { label: 'Title', value: 'weekly reading', type: 'text' },
    ])
  })
})

describe('rich_note list preview', () => {
  test('does not render rich note content in list preview even when showInList is true', () => {
    const section: Section = {
      _id: 's-rich-note',
      communityId: 'c-rich-note',
      name: 'Rich notes',
      icon: 'book',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2026-01-01',
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'w-title', type: 'short_text', label: 'Title', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'w-rich-note', type: 'rich_note', label: 'Rich note', fieldKey: 'richNote', required: false, order: 1, showInList: true },
      ],
    }

    const post: Post = {
      _id: 'p-rich-note',
      communityId: 'c-rich-note',
      sectionId: 's-rich-note',
      authorId: 'u-rich-note',
      status: 'active',
      content: {
        'w-title': 'weekly reading',
        'w-rich-note': {
          format: 'markdown',
          markdown: '**hello**',
          html: '<p><strong>hello</strong></p>',
          text: 'hello',
          imageFileIDs: [],
          schemaVersion: 1,
        },
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    expect(getListPreview(post, section)).toEqual([
      { label: 'Title', value: 'weekly reading', type: 'text' },
    ])
  })
})
