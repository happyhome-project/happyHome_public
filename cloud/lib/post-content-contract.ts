import {
  collaborationTemplateAsSection,
  normalizeCollaborationTemplate,
} from '../shared/collaboration-templates'
import type { CollaborationTemplate, Post, Section } from '../shared/types'

export type PostContentContractSource = Pick<Post, '_id' | 'communityId'> & Partial<Pick<
  Post,
  'sectionId' | 'area' | 'collaborationTemplateId'
>>

export type PostContentDocumentLoader = (
  collectionName: 'sections' | 'collaboration_templates',
  id: string,
) => Promise<unknown | null>

export async function loadPostContentSection(
  post: PostContentContractSource,
  loadDocument: PostContentDocumentLoader,
): Promise<Section | null> {
  if (post.area === 'archive') return null

  if (post.area === 'collaboration') {
    const templateId = String(post.collaborationTemplateId || '').trim()
    if (!templateId) return null
    const template = await loadDocument('collaboration_templates', templateId) as CollaborationTemplate | null
    if (!template) return null
    return collaborationTemplateAsSection(
      normalizeCollaborationTemplate(template),
      String(post.communityId || '').trim(),
    )
  }

  const sectionId = String(post.sectionId || '').trim()
  if (!sectionId) return null
  return await loadDocument('sections', sectionId) as Section | null
}
