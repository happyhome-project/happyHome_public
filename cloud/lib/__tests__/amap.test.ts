import { buildAmapPoiSearchUrl, normalizeAmapPoiResponse } from '../amap'

test('buildAmapPoiSearchUrl: 使用高德 POI 2.0 关键字搜索接口', () => {
  const url = buildAmapPoiSearchUrl({
    key: 'amap-key',
    keyword: '太平水库',
    region: '德阳',
    limit: 8,
  })

  expect(url).toContain('https://restapi.amap.com/v5/place/text?')
  expect(url).toContain('key=amap-key')
  expect(url).toContain(`keywords=${encodeURIComponent('太平水库')}`)
  expect(url).toContain(`region=${encodeURIComponent('德阳')}`)
  expect(url).toContain('page_size=8')
  expect(url).toContain('city_limit=false')
})

test('normalizeAmapPoiResponse: 解析高德返回的 lng,lat 为 GCJ-02 候选点', () => {
  const candidates = normalizeAmapPoiResponse({
    status: '1',
    pois: [
      {
        id: 'B0FFTEST',
        name: '太平水库',
        pname: '四川省',
        cityname: '德阳市',
        adname: '绵竹市',
        address: '太平水库',
        location: '104.133456,31.405678',
      },
      {
        id: 'BAD',
        name: '无坐标',
        location: [],
      },
    ],
  })

  expect(candidates).toEqual([
    {
      id: 'B0FFTEST',
      name: '太平水库',
      address: '四川省德阳市绵竹市太平水库',
      province: '四川省',
      city: '德阳市',
      district: '绵竹市',
      lat: 31.405678,
      lng: 104.133456,
      coordSystem: 'gcj02',
      source: 'amap',
    },
  ])
})
