export function asCollaborationSection(template: any, communityId = '') {
  const templateId = String(template?._id || template?.collaborationTemplateId || '').trim()
  return {
    ...template,
    _id: templateId,
    collaborationTemplateId: templateId,
    communityId: String(communityId || template?.communityId || '').trim(),
    systemKey: String(template?.systemKey || '').trim(),
    name: String(template?.name || '').trim(),
    icon: String(template?.icon || '').trim(),
    order: Number.isFinite(Number(template?.order)) ? Number(template.order) : 0,
    type: 'realtime',
    status: template?.status === 'disabled' ? 'archived' : 'active',
    displayTemplate: 'default',
    enableComment: template?.enableComment !== false,
    enableLike: template?.enableLike !== false,
    widgets: Array.isArray(template?.widgets)
      ? template.widgets.map((widget: any) => ({ ...widget }))
      : [],
    isCollaborationTemplate: true,
  }
}

export function isCollaborationSection(value: any): boolean {
  return Boolean(
    value?.isCollaborationTemplate === true
    && String(value?.collaborationTemplateId || '').trim()
    && String(value?._id || '').trim() === String(value?.collaborationTemplateId || '').trim(),
  )
}
