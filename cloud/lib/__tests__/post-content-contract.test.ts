import { buildInitialCollaborationTemplates } from '../../shared/collaboration-templates'
import { loadPostContentSection } from '../post-content-contract'

const carpoolTemplate = buildInitialCollaborationTemplates()[0]

test('loads a collaboration post schema from the global template without reading sections', async () => {
  const loadDocument = jest.fn(async (collectionName: string, id: string) => {
    if (collectionName === 'collaboration_templates' && id === carpoolTemplate._id) return carpoolTemplate
    return null
  })

  const section = await loadPostContentSection({
    _id: 'post-1',
    communityId: 'community-1',
    area: 'collaboration',
    collaborationTemplateId: carpoolTemplate._id,
  }, loadDocument)

  expect(loadDocument).toHaveBeenCalledTimes(1)
  expect(loadDocument).toHaveBeenCalledWith('collaboration_templates', carpoolTemplate._id)
  expect(section).toEqual(expect.objectContaining({
    _id: carpoolTemplate._id,
    communityId: 'community-1',
    name: '拼车出行',
    type: 'realtime',
    status: 'active',
  }))
  expect(section?.widgets[section.widgets.length - 1]).toEqual(expect.objectContaining({
    widgetId: 'carpool_note',
    type: 'note_blocks',
    required: false,
  }))
})

test('loads a legacy post schema from sections and leaves section-free archive posts virtual', async () => {
  const legacySection = { _id: 'section-1', communityId: 'community-1', name: '旧板块', widgets: [] }
  const loadDocument = jest.fn(async () => legacySection)

  await expect(loadPostContentSection({
    _id: 'legacy-post', communityId: 'community-1', sectionId: 'section-1',
  }, loadDocument)).resolves.toBe(legacySection)
  await expect(loadPostContentSection({
    _id: 'archive-post', communityId: 'community-1', area: 'archive',
  }, loadDocument)).resolves.toBeNull()

  expect(loadDocument).toHaveBeenCalledTimes(1)
  expect(loadDocument).toHaveBeenCalledWith('sections', 'section-1')
})

test('returns null for a malformed section-free collaboration post without issuing a database read', async () => {
  const loadDocument = jest.fn()
  await expect(loadPostContentSection({
    _id: 'post-1', communityId: 'community-1', area: 'collaboration',
  }, loadDocument)).resolves.toBeNull()
  expect(loadDocument).not.toHaveBeenCalled()
})
