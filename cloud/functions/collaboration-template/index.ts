import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { normalizeCollaborationTemplate } from '../../shared/collaboration-templates'
import type { CollaborationTemplate } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleListActive() {
  const templates = await db.query(
    'collaboration_templates',
    { status: 'active' },
    { orderBy: ['order', 'asc'] },
  ) as CollaborationTemplate[]
  return { templates: templates.map(normalizeCollaborationTemplate) }
}

export async function handleGet(params: { templateId?: string }) {
  const templateId = String(params.templateId || '').trim()
  if (!templateId) throw new Error('templateId 不能为空')
  const template = await db.getById('collaboration_templates', templateId) as CollaborationTemplate | null
  return { template: template ? normalizeCollaborationTemplate(template) : null }
}

export const main = async (event: any) => {
  const { action, ...params } = event || {}
  if (action === 'listActive') return handleListActive()
  if (action === 'get') return handleGet(params)
  throw new Error(`Unknown action: ${action}`)
}
