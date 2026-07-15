import {
  CARPOOL_WIDGET_IDS,
  buildInitialCollaborationTemplates,
  collaborationTemplateAsSection,
  findUnsafeCollaborationTemplateChanges,
} from '../collaboration-templates'

describe('global collaboration template contract', () => {
  test('defines exactly the initial carpool and activity-invite templates', () => {
    const templates = buildInitialCollaborationTemplates()

    expect(templates.map((template) => template.systemKey)).toEqual([
      'carpool',
      'activity_invite',
    ])
    expect(templates.every((template) => template.status === 'active')).toBe(true)
    expect(templates.every((template) => template.protectedSystemKey)).toBe(true)
  })

  test('adds an optional image-capable note immediately after carpool location', () => {
    const carpool = buildInitialCollaborationTemplates()[0]
    const locationIndex = carpool.widgets.findIndex((widget) => widget.widgetId === CARPOOL_WIDGET_IDS.location)

    expect(carpool.name).toBe('拼车出行')
    expect(carpool.widgets[locationIndex + 1]).toEqual({
      widgetId: CARPOOL_WIDGET_IDS.note,
      type: 'note_blocks',
      label: '补充说明',
      fieldKey: 'note',
      required: false,
      order: locationIndex + 1,
      showInList: false,
    })
  })

  test('converts a global template to the section-shaped validation contract without community scope', () => {
    const carpool = buildInitialCollaborationTemplates()[0]

    expect(collaborationTemplateAsSection(carpool)).toEqual(expect.objectContaining({
      _id: carpool._id,
      communityId: '',
      systemKey: 'carpool',
      type: 'realtime',
      status: 'active',
      widgets: carpool.widgets,
    }))
  })

  test('classifies widget deletion, type changes, id changes, and new required fields as unsafe', () => {
    const current = buildInitialCollaborationTemplates()[0]
    const withoutOrigin = current.widgets.filter((widget) => widget.widgetId !== CARPOOL_WIDGET_IDS.origin)
    const changedType = current.widgets.map((widget) => widget.widgetId === CARPOOL_WIDGET_IDS.destination
      ? { ...widget, type: 'summary' as const }
      : widget)
    const newlyRequired = [...current.widgets, {
      widgetId: 'carpool_extra',
      type: 'short_text' as const,
      label: '额外字段',
      fieldKey: 'extra',
      required: true,
      order: current.widgets.length,
      showInList: false,
    }]

    expect(findUnsafeCollaborationTemplateChanges(current.widgets, withoutOrigin)).toContain('widget_removed')
    expect(findUnsafeCollaborationTemplateChanges(current.widgets, changedType)).toContain('widget_type_changed')
    expect(findUnsafeCollaborationTemplateChanges(current.widgets, newlyRequired)).toContain('required_widget_added')
  })
})
