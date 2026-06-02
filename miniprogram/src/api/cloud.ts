// Wraps cloud calls with unified error handling.
// Runtime routing:
//   1. Mini-program: always use wx.cloud.callFunction so WeChat injects real OPENID.
//   2. H5 preview: use http-gateway with injected test openid.
// Do not let stale DEV gateway flags affect real mini-program users.
import { clientLog } from '../utils/client-log'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore 鈥?wx is injected by the miniprogram runtime; absent in H5 build
const _wx: any = typeof wx !== 'undefined' ? wx : undefined
const IS_H5 = !_wx?.cloud?.callFunction

// H5 gateway config 鈥?set via Vite env (.env.h5) or fallback defaults.
const viteEnv = (import.meta as any).env || {}
const H5_GATEWAY_URL: string =
  viteEnv.VITE_H5_GATEWAY_URL ||
  'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com/http-gateway'
const H5_GATEWAY_TOKEN: string =
  viteEnv.VITE_H5_GATEWAY_TOKEN || 'happyhome-admin-2024'

/** Read a key from whichever storage is available (localStorage in H5, wx.getStorageSync in mp). */
function readStorage(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key)
      if (v) return v
    }
  } catch (_error) { /* ignore */ }
  try {
    if (typeof uni !== 'undefined' && uni.getStorageSync) {
      const v = uni.getStorageSync(key)
      if (v) return String(v)
    }
  } catch (_error) { /* ignore */ }
  return null
}

function getTestOpenid(): string {
  return readStorage('test-openid') || 'h5-test-user-001'
}

/** Should this call go through http-gateway instead of wx.cloud? */
function shouldUseGateway(): boolean {
  // In the real mini-program runtime, stale DEV flags must not bypass wx.cloud.
  return IS_H5
}

function copyParams(target: Record<string, any>, params: object) {
  const source: any = params || {}
  Object.keys(source).forEach((key) => {
    target[key] = source[key]
  })
  return target
}

async function callViaHttpGateway<T>(name: string, action: string, params: object): Promise<T> {
  // Use fetch in H5; uni.request in miniprogram (fetch is not guaranteed in all mp runtimes)
  const body = copyParams({ _fn: name, action }, params)
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${H5_GATEWAY_TOKEN}`,
    'x-test-openid': getTestOpenid(),
  }

  let data: any, statusCode = 0
  if (typeof fetch !== 'undefined' && IS_H5) {
    const res = await fetch(H5_GATEWAY_URL, { method: 'POST', headers, body: JSON.stringify(body) })
    statusCode = res.status
    const text = await res.text()
    try { data = text ? JSON.parse(text) : {} } catch (_error) { data = { raw: text } }
  } else {
    // miniprogram: use uni.request
    const res: any = await new Promise((resolve, reject) => {
      uni.request({
        url: H5_GATEWAY_URL,
        method: 'POST',
        header: headers,
        data: body,
        success: resolve,
        fail: reject,
      })
    })
    statusCode = res.statusCode
    data = res.data
  }

  if (statusCode !== 200) {
    const msg = data?.error || `HTTP ${statusCode}`
    throw new Error(`[http-gateway] ${name}/${action} failed: ${msg}`)
  }
  return normalizeCloudResult<T>(data, name, action, 'http-gateway')
}

function normalizeCloudResult<T>(data: any, name: string, action: string, source: string): T {
  if (data?.error) {
    throw new Error(`[${source}] ${name}/${action}: ${data.error}`)
  }
  if (data?.success === false) {
    const msg = data?.message || data?.errMsg || 'request failed'
    throw new Error(`[${source}] ${name}/${action}: ${msg}`)
  }
  return data as T
}

function summarizeParams(params: any) {
  const summary: Record<string, any> = {}
  if (!params || typeof params !== 'object') return summary
  const allowed = [
    'communityId',
    'sectionId',
    'postId',
    'widgetId',
    'skip',
    'limit',
    'includeAll',
    'seatCount',
  ]
  for (const key of allowed) {
    if (params[key] !== undefined) summary[key] = params[key]
  }
  if (params.content && typeof params.content === 'object') {
    summary.contentKeys = Object.keys(params.content)
  }
  return summary
}

export async function callCloud<T = any>(
  name: string, action: string, params: object = {}
): Promise<T> {
  const startedAt = Date.now()
  const source = shouldUseGateway() ? 'http-gateway' : 'wx.cloud'
  clientLog('debug', 'cloud.call.start', {
    name,
    action,
    source,
    params: summarizeParams(params),
  })
  if (shouldUseGateway()) {
    try {
      const result = await callViaHttpGateway<T>(name, action, params)
      clientLog('debug', 'cloud.call.success', {
        name,
        action,
        source,
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      clientLog('error', 'cloud.call.fail', {
        name,
        action,
        source,
        durationMs: Date.now() - startedAt,
        error,
      })
      throw error
    }
  }

  return new Promise((resolve, reject) => {
    _wx.cloud.callFunction({
      name,
      data: copyParams({ action }, params),
      success: (res: any) => {
        try {
          const result = normalizeCloudResult<T>(res.result, name, action, 'wx.cloud')
          clientLog('debug', 'cloud.call.success', {
            name,
            action,
            source,
            durationMs: Date.now() - startedAt,
          })
          resolve(result)
        } catch (error) {
          clientLog('error', 'cloud.call.fail', {
            name,
            action,
            source,
            durationMs: Date.now() - startedAt,
            error,
          })
          reject(error)
        }
      },
      fail: (error: any) => {
        const wrapped = new Error(error?.errMsg || error?.message || String(error))
        clientLog('error', 'cloud.call.fail', {
          name,
          action,
          source,
          durationMs: Date.now() - startedAt,
          error: wrapped,
        })
        reject(wrapped)
      }
    })
  })
}

export const userApi = {
  login: (params: { nickName: string; avatarUrl: string }) =>
    callCloud<{ user: any; isNew: boolean }>('user', 'login', params)
}

export const communityApi = {
  list: (includeAll = false) =>
    callCloud<{ communities: any[] }>('community', 'list', { includeAll }),
  listDiscoverable: () =>
    callCloud<{ communities: any[] }>('community', 'listDiscoverable', {}),
  get: (communityId: string) =>
    callCloud<{ community: any }>('community', 'get', { communityId }),
  create: (params: object) =>
    callCloud('community', 'create', params),
}

export const memberApi = {
  myStatus: (communityId: string) =>
    callCloud<{ isMember: boolean; status: string | null }>('member', 'myStatus', { communityId }),
  apply: (communityId: string) =>
    callCloud('member', 'apply', { communityId }),
  leave: (communityId: string) =>
    callCloud('member', 'leave', { communityId }),
  memberApprove: (communityId: string, memberId: string) =>
    callCloud('member', 'memberApprove', { communityId, memberId }),
  memberReject: (communityId: string, memberId: string) =>
    callCloud('member', 'memberReject', { communityId, memberId }),
  pendingList: (communityId: string) =>
    callCloud<{ members: any[] }>('member', 'pendingList', { communityId }),
  myCommunities: () =>
    callCloud<{ communities: any[] }>('member', 'myCommunities', {}),
}

export type ApprovalNotificationEventType = 'member_join_pending' | 'community_create_pending'
export type ApprovalNotificationTemplateConfig = {
  eventType: ApprovalNotificationEventType
  templateId: string
}

export const notificationApi = {
  config: () =>
    callCloud<{ templates: ApprovalNotificationTemplateConfig[] }>('member', 'notificationConfig', {}),
  saveSubscription: (params: {
    eventType: ApprovalNotificationEventType
    templateId: string
    status: 'accept' | 'reject'
  }) =>
    callCloud<{ success: true }>('member', 'saveNotificationSubscription', params),
  mySubscriptions: () =>
    callCloud<{ subscriptions: Array<{ eventType: ApprovalNotificationEventType; templateId: string; status: string }> }>(
      'member',
      'notificationSubscriptions',
      {},
    ),
}

export const sectionApi = {
  list: (communityId: string) =>
    callCloud<{ sections: any[] }>('section', 'list', { communityId }),
  get: (sectionId: string) =>
    callCloud<{ section: any }>('section', 'get', { sectionId }),
}

export const postApi = {
  list: (sectionId: string, skip = 0) =>
    callCloud<{ posts: any[] }>('post', 'list', { sectionId, skip }),
  get: (postId: string) =>
    callCloud<{ post: any }>('post', 'get', { postId }),
  create: (params: object) =>
    callCloud('post', 'create', params),
  update: (postId: string, content: Record<string, any>) =>
    callCloud('post', 'update', { postId, content }),
  delete: (postId: string) =>
    callCloud('post', 'delete', { postId }),
  joinAttendance: (postId: string, widgetId: string, seatCount?: number) =>
    callCloud<{ widgetId: string; summary: any }>('post', 'joinAttendance', { postId, widgetId, seatCount }),
  leaveAttendance: (postId: string, widgetId: string) =>
    callCloud<{ widgetId: string; summary: any }>('post', 'leaveAttendance', { postId, widgetId }),
  listAttendanceMembers: (postId: string, widgetId: string) =>
    callCloud<{ widgetId: string; members: any[]; total: number; occupiedSeats: number; capacity?: number; isFull: boolean }>(
      'post',
      'listAttendanceMembers',
      { postId, widgetId }
    ),
}
