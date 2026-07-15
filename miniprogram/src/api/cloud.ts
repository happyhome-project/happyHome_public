// Wraps cloud calls with unified error handling.
// Runtime routing:
//   1. Mini-program: always use wx.cloud.callFunction so WeChat injects real OPENID.
//   2. H5: use the CloudBase Web SDK.
// Do not let stale DEV gateway flags affect real mini-program users.
import { clientLog } from '../utils/client-log'
import { sanitizePerformanceTrace, type PerformanceTrace } from '../utils/performance-trace'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore 鈥?wx is injected by the miniprogram runtime; absent in H5 build
const _wx: any = typeof wx !== 'undefined' ? wx : undefined
const IS_H5 = !_wx?.cloud?.callFunction

function copyParams(target: Record<string, any>, params: object) {
  const source: any = params || {}
  Object.keys(source).forEach((key) => {
    target[key] = source[key]
  })
  return target
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
  name: string, action: string, params: object = {}, trace?: PerformanceTrace
): Promise<T> {
  const startedAt = Date.now()
  const source = IS_H5 ? 'web-cloudbase' : 'wx.cloud'
  const safeTrace = sanitizePerformanceTrace(trace)
  const data = copyParams({ action }, params)
  if (safeTrace) data._trace = safeTrace
  clientLog('debug', 'cloud.call.start', {
    name,
    action,
    source,
    params: summarizeParams(params),
    trace: safeTrace,
  })
  if (IS_H5) {
    // #ifdef H5
    try {
      const { callFunction } = await import('./web-cloudbase')
      const response = await callFunction(name, data)
      const result = normalizeCloudResult<T>(response, name, action, 'web-cloudbase')
      clientLog('debug', 'cloud.call.success', {
        name,
        action,
        source,
        durationMs: Date.now() - startedAt,
        trace: safeTrace,
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
    // #endif
  }

  return new Promise((resolve, reject) => {
    _wx.cloud.callFunction({
      name,
      data,
      success: (res: any) => {
        try {
          const result = normalizeCloudResult<T>(res.result, name, action, 'wx.cloud')
          clientLog('debug', 'cloud.call.success', {
            name,
            action,
            source,
            durationMs: Date.now() - startedAt,
            requestId: res?.requestId || res?.requestID || '',
            trace: safeTrace,
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
  login: (params: { nickName: string; avatarUrl: string }, trace?: PerformanceTrace) =>
    callCloud<{ user: any; isNew: boolean }>('user', 'login', params, trace)
}

export const communityApi = {
  list: (includeAll = false) =>
    callCloud<{ communities: any[] }>('community', 'list', { includeAll }),
  pendingList: () =>
    callCloud<{ communities: any[] }>('community', 'pendingList', {}),
  listDiscoverable: (trace?: PerformanceTrace) =>
    callCloud<{ communities: any[] }>('community', 'listDiscoverable', {}, trace),
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
  myCommunities: (trace?: PerformanceTrace) =>
    callCloud<{ communities: any[] }>('member', 'myCommunities', {}, trace),
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

export const collaborationTemplateApi = {
  listActive: () =>
    callCloud<{ templates: any[] }>('collaboration-template', 'listActive', {}),
  get: (templateId: string) =>
    callCloud<{ template: any }>('collaboration-template', 'get', { templateId }),
}

export type ArchivePostCreateParams = {
  communityId: string
  area: 'archive'
  format: 'image_text' | 'text'
  topics?: string[]
  content: Record<string, any>
  presentation?: { textNoteTheme?: 'paper' | 'mint' | 'slate' | 'headline' | 'quote' | 'notice' }
}

export type ArchivePostListParams = {
  communityId: string
  topicKey?: string
  cursor?: string
  limit?: number
  asGuest?: boolean
}

export type ArchiveTab = {
  topicKey: string
  displayName: string
  origin?: 'all' | 'legacy' | 'admin' | 'organic'
}

export const postApi = {
  bootstrap: (currentCommunityId?: string, limitPerSection = 20, asGuest = false, trace?: PerformanceTrace) =>
    callCloud<any>(
      'post',
      'bootstrap',
      { currentCommunityId, limitPerSection, asGuest },
      trace,
    ),
  home: (communityId: string, limitPerSection = 20, asGuest = false) =>
    callCloud<{
      sections: any[]
      postsBySection: Record<string, any[]>
      collaborationTemplates: any[]
      collaborationPostsByTemplate: Record<string, any[]>
    }>(
      'post',
      'home',
      { communityId, limitPerSection, asGuest },
    ),
  list: (sectionId: string, skip = 0, asGuest = false) =>
    callCloud<{ posts: any[] }>('post', 'list', { sectionId, skip, asGuest }),
  listCollaboration: (communityId: string, collaborationTemplateId: string, skip = 0, asGuest = false) =>
    callCloud<{ template: any; posts: any[]; total: number; skip: number; limit: number; hasMore: boolean }>(
      'post',
      'listCollaboration',
      { communityId, collaborationTemplateId, skip, asGuest },
    ),
  listMine: (skip = 0, limit = 20) =>
    callCloud<{ posts: any[]; total: number; skip: number; limit: number; hasMore: boolean }>(
      'post',
      'listMine',
      { skip, limit },
    ),
  listArchive: (params: ArchivePostListParams) =>
    callCloud<{ posts: any[]; nextCursor: string; hasMore: boolean }>('post', 'listArchive', params),
  listArchiveTabs: (params: { communityId: string; asGuest?: boolean }) =>
    callCloud<{ tabs: ArchiveTab[] }>('post', 'listArchiveTabs', params),
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
    callCloud<{ post: any; collaborationTemplate?: any }>('post', 'get', { postId, asGuest }),
  create: (params: object) =>
    callCloud('post', 'create', params),
  createArchive: (params: ArchivePostCreateParams) =>
    callCloud<{ postId: string; auditStatus?: string; auditReason?: string }>('post', 'create', params),
  createCollaboration: (params: {
    communityId: string
    collaborationTemplateId: string
    content: Record<string, any>
  }) => callCloud<{ postId: string; auditStatus?: string; auditReason?: string }>(
    'post',
    'createCollaboration',
    params,
  ),
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
  update: (
    postId: string,
    content: Record<string, any>,
    options: { topics?: string[]; presentation?: Record<string, any> } = {},
  ) => callCloud('post', 'update', Object.assign({ postId, content }, options)),
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
