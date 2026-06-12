import { validateRequiredWidgets } from '../post-validate'
import type { Section } from '../../shared/types'

function sectionWithRequiredDestination(): Section {
  return {
    _id: 'section-guide',
    communityId: 'community-1',
    name: '亲子出游',
    icon: 'walk',
    order: 1,
    enableComment: true,
    enableLike: true,
    createdAt: '2026-06-12T00:00:00.000Z',
    type: 'evergreen',
    status: 'active',
    displayTemplate: 'guide_note',
    widgets: [
      {
        widgetId: 'guide_location',
        type: 'location',
        label: '目的地位置',
        fieldKey: 'location',
        required: true,
        order: 7,
        showInList: false,
        locked: true,
      },
    ],
  }
}

test('validateRequiredWidgets: 必填目的地位置必须包含有效坐标', () => {
  const section = sectionWithRequiredDestination()

  expect(() => validateRequiredWidgets(section, {})).toThrow('必填项未填写：目的地位置')
  expect(() => validateRequiredWidgets(section, {
    guide_location: { address: '太平水库', lat: 0, lng: 0 },
  })).toThrow('必填项未填写：目的地位置')
  expect(() => validateRequiredWidgets(section, {
    guide_location: {
      name: '太平水库',
      address: '四川省德阳市绵竹市太平水库',
      lat: 31.405678,
      lng: 104.133456,
      coordSystem: 'gcj02',
      source: 'amap',
      adjusted: true,
    },
  } as any)).not.toThrow()
})
