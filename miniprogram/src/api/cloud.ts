// Wraps wx.cloud.callFunction with unified error handling.
// In H5 preview mode, transparently routes calls through the http-gateway
// cloud function so developers can drive full-stack flows from the browser.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — wx is injected by the miniprogram runtime; absent in H5 build
const _wx: any = typeof wx !== 'undefined' ? wx : undefined
const IS_H5 = !_wx?.cloud?.callFunction

// H5 gateway config — set via Vite env (.env.h5) or fallback defaults.
const viteEnv = (import.meta as any).env || {}
const H5_GATEWAY_URL: string =
  viteEnv.VITE_H5_GATEWAY_URL ||
  'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com/http-gateway'
const H5_GATEWAY_TOKEN: string =
  viteEnv.VITE_H5_GATEWAY_TOKEN || 'happyhome-admin-2024'

function getTestOpenid(): string {
  // Allow swapping test identities via devtools: localStorage.setItem('test-openid', 'xyz')
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('test-openid') : null
    if (stored) return stored
  } catch { /* ignore */ }
  return 'h5-test-user-001'
}

async function callViaHttpGateway<T>(name: string, action: string, params: object): Promise<T> {
  const res = await fetch(H5_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${H5_GATEWAY_TOKEN}`,
      'x-test-openid': getTestOpenid(),
    },
    body: JSON.stringify({ _fn: name, action, ...params }),
  })
  const text = await res.text()
  let data: any
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`
    throw new Error(`[http-gateway] ${name}/${action} failed: ${msg}`)
  }
  if (data?.error) throw new Error(`[http-gateway] ${name}/${action}: ${data.error}`)
  return data as T
}

export async function callCloud<T = any>(
  name: string, action: string, params: object = {}
): Promise<T> {
  if (IS_H5) return callViaHttpGateway<T>(name, action, params)

  return new Promise((resolve, reject) => {
    _wx.cloud.callFunction({
      name,
      data: { action, ...params },
      success: (res: any) => resolve(res.result),
      fail: reject
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
}
