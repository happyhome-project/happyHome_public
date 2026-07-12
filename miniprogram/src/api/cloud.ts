// Wraps cloud calls with unified error handling.
// Runtime routing:
//   1. Mini-program: always use wx.cloud.callFunction so WeChat injects real OPENID.
//   2. H5 preview: use an explicitly configured development gateway.
// Do not let stale DEV gateway flags affect real mini-program users.
import { clientLog } from '../utils/client-log'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore 鈥?wx is injected by the miniprogram runtime; absent in H5 build
const _wx: any = typeof wx !== 'undefined' ? wx : undefined
const IS_H5 = !_wx?.cloud?.callFunction

// H5 gateway is opt-in. Production credentials must never be bundled into H5.
const viteEnv = (import.meta as any).env || {}
const H5_GATEWAY_URL: string =
  String(viteEnv.VITE_H5_GATEWAY_URL || '').trim()
const H5_GATEWAY_TOKEN: string =
  String(viteEnv.VITE_H5_GATEWAY_TOKEN || '').trim()

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
  if (!H5_GATEWAY_URL || H5_GATEWAY_TOKEN.length < 32) {
    throw new Error('[h5-gateway] disabled; configure VITE_H5_GATEWAY_URL and a strong VITE_H5_GATEWAY_TOKEN for development only')
  }
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

function buildCloudCallFailure(name: string, action: string, error: any) {
  const rawMessage = error?.errMsg || error?.message || String(error)
  const wrapped = new Error(`[wx.cloud] ${name}/${action}: ${rawMessage}`)
  ;(wrapped as any).errCode = error?.errCode
  ;(wrapped as any).errMsg = error?.errMsg
  ;(wrapped as any).cloudFunction = name
  ;(wrapped as any).action = action
  ;(wrapped as any).requestId = error?.requestId || error?.requestID || error?.callId || ''
  ;(wrapped as any).raw = error
  return wrapped
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
        const wrapped = buildCloudCallFailure(name, action, error)
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
  pendingList: () =>
    callCloud<{ communities: any[] }>('community', 'pendingList', {}),
  listDiscoverable: () =>
    callCloud<{ communities: any[] }>('community', 'listDiscoverable', {}),
  get: (communityId: string) =>
    callCloud<{ community: any }>('community', 'get', { communityId }),
  create: (params: object) =>
    callCloud('community', 'create', params),
  approve: (communityId: string) =>
    callCloud('community', 'approve', { communityId }),
  reject: (communityId: string) =>
    callCloud('community', 'reject', { communityId }),
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
  status: () =>
    callCloud<{
      subscriptions: Array<{ eventType: ApprovalNotificationEventType; templateId: string; status: string }>
      needsAuthorization: boolean
      lastBlockingReason?: string
      lastBlockingAt?: string
    }>('member', 'notificationStatus', {}),
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
  list: (communityId: string, asGuest = false) =>
    callCloud<{ sections: any[] }>('section', 'list', { communityId, asGuest }),
  get: (sectionId: string, asGuest = false) =>
    callCloud<{ section: any }>('section', 'get', { sectionId, asGuest }),
}

export const postApi = {
  bootstrap: (currentCommunityId?: string, limitPerSection = 20, asGuest = false) =>
    callCloud<any>(
      'post',
      'bootstrap',
      { currentCommunityId, limitPerSection, asGuest },
    ),
  home: (communityId: string, limitPerSection = 20, asGuest = false) =>
    callCloud<{ sections: any[]; postsBySection: Record<string, any[]> }>(
      'post',
      'home',
      { communityId, limitPerSection, asGuest },
    ),
  list: (sectionId: string, skip = 0, asGuest = false) =>
    callCloud<{ posts: any[] }>('post', 'list', { sectionId, skip, asGuest }),
  search: (params: {
    communityId: string
    query: string
    sectionId?: string
    skip?: number
    limit?: number
    asGuest?: boolean
  }) =>
    callCloud<{
      protocolVersion: 2
      query: string
      communityId: string
      sectionId?: string
      total: number
      skip: number
      limit: number
      tookMs: number
      /** @deprecated Semantic search never generates an answer; always empty when present. */
      answer?: ''
      /** @deprecated Compatibility only; semantic v2 returns rag or no_answer when present. */
      mode?: 'rag' | 'no_answer'
      /** @deprecated Semantic search returns items directly; always empty when present. */
      citations?: []
      items: Array<{
        postId: string
        communityId: string
        sectionId: string
        sectionName: string
        title: string
        coverImage?: string
        authorName?: string
        authorAvatarUrl?: string
        matchedSnippet: string
        matchedField: string
        createdAt: string
        updatedAt: string
      }>
    }>('post', 'search', params),
  get: (postId: string, asGuest = false) =>
    callCloud<{ post: any }>('post', 'get', { postId, asGuest }),
  create: (params: object) =>
    callCloud('post', 'create', params),
  getActivityInviteState: (sourcePostId: string, asGuest = false) =>
    callCloud<{
      enabled: boolean
      sourcePostId: string
      prefill: { title: string; location?: any }
      invite: any | null
      targetSection: { _id?: string; sectionId: string; name: string; systemKey?: string; widgets?: any[]; type?: string } | null
    }>('post', 'getActivityInviteState', { sourcePostId, asGuest }),
  createActivityInvite: (sourcePostId: string, content: Record<string, any>) =>
    callCloud<{ postId: string; sectionId?: string; alreadyExists?: boolean; auditStatus?: string; auditReason?: string }>(
      'post',
      'createActivityInvite',
      { sourcePostId, content },
    ),
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
