import cloud from 'wx-server-sdk'
import { resolveOpenIdByBackgroundFetchToken } from '../../lib/background-fetch-token'
import {
  buildHomeSnapshot,
  emptyHomeSnapshot,
  serializeHomeSnapshotForPrefetch,
} from '../../lib/home-snapshot'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'access-control-allow-origin': '*',
}

function getQuery(event: any): Record<string, any> {
  if (event?.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters
  }
  if (event?.query && typeof event.query === 'object') {
    return event.query
  }
  if (event && typeof event === 'object') {
    return event
  }
  return {}
}

function response(body: string) {
  return {
    statusCode: 200,
    headers: HEADERS,
    body,
  }
}

export const main = async (event: any) => {
  const httpMethod = event?.httpMethod ? String(event.httpMethod).toUpperCase() : ''
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...HEADERS,
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
      body: '',
    }
  }
  if (httpMethod && httpMethod !== 'GET') {
    return response(serializeHomeSnapshotForPrefetch(emptyHomeSnapshot('')))
  }

  try {
    const query = getQuery(event)
    const token = String(query.token || '').trim()
    const openid = await resolveOpenIdByBackgroundFetchToken(token)
    if (!openid) {
      return response(serializeHomeSnapshotForPrefetch(emptyHomeSnapshot('')))
    }
    const snapshot = await buildHomeSnapshot(openid)
    return response(serializeHomeSnapshotForPrefetch(snapshot))
  } catch (error) {
    console.warn('[home-prefetch] safe fallback', error)
    return response(serializeHomeSnapshotForPrefetch(emptyHomeSnapshot('')))
  }
}
