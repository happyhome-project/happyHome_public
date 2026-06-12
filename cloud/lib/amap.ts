import https from 'https'
import { URL } from 'url'

export interface AmapPoiSearchParams {
  keyword: string
  region?: string
  limit?: number
  key?: string
}

export interface AmapPoiCandidate {
  id: string
  name: string
  address: string
  province: string
  city: string
  district: string
  lat: number
  lng: number
  coordSystem: 'gcj02'
  source: 'amap'
}

interface HttpResponse {
  statusCode: number
  body: Buffer
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return ''
  return String(value || '').trim()
}

function amapWebServiceKey(): string {
  return String(process.env.AMAP_WEB_SERVICE_KEY || process.env.GAODE_WEB_SERVICE_KEY || '').trim()
}

function clampPageSize(limit: unknown): number {
  const n = Number(limit)
  if (!Number.isFinite(n)) return 8
  return Math.max(1, Math.min(25, Math.floor(n)))
}

export function buildAmapPoiSearchUrl(params: AmapPoiSearchParams): string {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) throw new Error('地点关键字不能为空')

  const key = String(params.key || amapWebServiceKey()).trim()
  if (!key) throw new Error('admin 函数缺少 AMAP_WEB_SERVICE_KEY 环境变量，无法检索高德地点')

  const url = new URL('https://restapi.amap.com/v5/place/text')
  url.searchParams.set('key', key)
  url.searchParams.set('keywords', keyword)
  url.searchParams.set('city_limit', 'false')
  url.searchParams.set('page_size', String(clampPageSize(params.limit)))
  url.searchParams.set('page_num', '1')
  url.searchParams.set('output', 'json')
  const region = String(params.region || '').trim()
  if (region) url.searchParams.set('region', region)
  return url.toString()
}

function httpsGet(urlStr: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        body: Buffer.concat(chunks),
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

function parseLocation(value: unknown): { lng: number; lat: number } | null {
  const text = stringValue(value)
  const [lngText, latText] = text.split(',')
  const lng = Number(lngText)
  const lat = Number(latText)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  if (lat === 0 && lng === 0) return null
  return { lng, lat }
}

function joinAddress(parts: string[]): string {
  const result: string[] = []
  for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
    if (result.some((existing) => existing === part || part.startsWith(existing))) continue
    result.push(part)
  }
  return result.join('')
}

export function normalizeAmapPoiResponse(payload: any): AmapPoiCandidate[] {
  if (!payload || payload.status !== '1') {
    const info = stringValue(payload?.info || payload?.infocode || '高德地点检索失败')
    throw new Error(info)
  }

  const pois = Array.isArray(payload.pois) ? payload.pois : []
  return pois
    .map((poi: any): AmapPoiCandidate | null => {
      const point = parseLocation(poi?.location)
      if (!point) return null
      const province = stringValue(poi?.pname)
      const city = stringValue(poi?.cityname)
      const district = stringValue(poi?.adname)
      const rawAddress = stringValue(poi?.address)
      const name = stringValue(poi?.name)
      const address = joinAddress([province, city, district, rawAddress || name])
      return {
        id: stringValue(poi?.id),
        name,
        address,
        province,
        city,
        district,
        lat: point.lat,
        lng: point.lng,
        coordSystem: 'gcj02',
        source: 'amap',
      }
    })
    .filter((item: AmapPoiCandidate | null): item is AmapPoiCandidate => Boolean(item))
}

export async function searchAmapPoi(params: AmapPoiSearchParams): Promise<AmapPoiCandidate[]> {
  const url = buildAmapPoiSearchUrl(params)
  const res = await httpsGet(url)
  let json: any
  try {
    json = JSON.parse(res.body.toString('utf-8'))
  } catch {
    throw new Error(`高德地点检索返回非 JSON：HTTP ${res.statusCode}`)
  }
  return normalizeAmapPoiResponse(json)
}
