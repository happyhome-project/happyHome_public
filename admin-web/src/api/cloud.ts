import axios from 'axios'

const BASE_URL = import.meta.env.VITE_CLOUD_API_URL

// Interceptor needs to reach the auth store lazily to avoid circular import.
// Registered from main.ts after pinia is set up; falls back to hard redirect to /login
// if no handler installed yet (e.g. early bootstrap requests).
let unauthorizedHandler: (() => void) | null = null
let redirectedToLogin = false
export function registerUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

const http = axios.create({ baseURL: BASE_URL })

http.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error?.response?.status
    if (status === 401 || status === 403) {
      if (unauthorizedHandler) {
        try { unauthorizedHandler() } catch { /* noop */ }
      } else if (!redirectedToLogin && location.pathname !== '/login') {
        // Bootstrap fallback: handler not registered yet → hard redirect
        redirectedToLogin = true
        localStorage.removeItem('token')
        location.replace('/login')
      }
    }
    return Promise.reject(error)
  }
)

async function callAdmin(action: string, params: Record<string, any> = {}) {
  const token = localStorage.getItem('token') || ''
  const res = await http.post(
    `/admin`,
    { action, ...params },
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  )
  return res.data
}

// Keep for backward compat with WidgetEditor.vue which imports callCloud
export const callCloud = callAdmin

export type WxLoginStatus = 'pending' | 'success' | 'no_account' | 'expired' | 'denied'

export interface WxLoginStartRes {
  ticket: string
  qrCodeBase64: string  // data:image/png;base64,...
  expiresAt: string
}

export interface WxLoginPollRes {
  status: WxLoginStatus
  token?: string
  role?: 'superAdmin' | 'communityAdmin'
  userId?: string
  username?: string
}

export const authApi = {
  login: (username: string, password: string) => callAdmin('auth.login', { username, password }),
  logout: () => callAdmin('auth.logout'),
  me: () => callAdmin('auth.me'),
  wxLoginStart: () => callAdmin('auth.wxLoginStart') as Promise<WxLoginStartRes>,
  wxLoginPoll: (ticket: string) =>
    callAdmin('auth.wxLoginPoll', { ticket }) as Promise<WxLoginPollRes>,
}

export const adminAccountApi = {
  list: () => callAdmin('admin.listAccounts'),
  create: (params: { username: string; password: string; role: 'superAdmin' | 'communityAdmin'; userId?: string }) =>
    callAdmin('admin.createAccount', params),
  resetPassword: (accountId: string, password: string) =>
    callAdmin('admin.resetPassword', { accountId, password }),
  delete: (accountId: string) => callAdmin('admin.deleteAccount', { accountId }),
  bindWechat: (accountId: string, openId: string) => callAdmin('admin.bindWechat', { accountId, openId }),
}

export const communityApi = {
  list: () => callAdmin('community.list'),
  listDisabled: () => callAdmin('community.listDisabled'),
  approve: (communityId: string) => callAdmin('community.approve', { communityId }),
  reject: (communityId: string) => callAdmin('community.reject', { communityId }),
  disable: (communityId: string) => callAdmin('community.disable', { communityId }),
  restore: (communityId: string) => callAdmin('community.restore', { communityId }),
  hardDelete: (communityId: string) => callAdmin('community.hardDelete', { communityId }),
  updateMeta: (params: { communityId: string; name?: string; description?: string; motto?: string; mottoCite?: string; joinType?: 'open' | 'approval' }) =>
    callAdmin('community.updateMeta', params),
  createAdmin: (params: {
    name: string
    description: string
    coverImage: string
    location: { address: string; lat: number; lng: number }
    joinType: 'open' | 'approval'
  }) => callAdmin('community.createAdmin', params),
}

export const sectionApi = {
  list: (communityId: string) => callAdmin('section.list', { communityId }),
  create: (params: {
    communityId: string
    name: string
    icon: string
    order: number
    type?: 'realtime' | 'evergreen'
    accentColor?: string
    enableComment?: boolean
    enableLike?: boolean
  }) =>
    callAdmin('section.create', params),
  get: (sectionId: string) => callAdmin('section.get', { sectionId }),
  delete: (sectionId: string) => callAdmin('section.delete', { sectionId }),
  updateWidgets: (params: {
    sectionId: string
    communityId?: string
    widgets: any[]
    preview?: boolean
    confirmStructureChange?: boolean
  }) =>
    callAdmin('section.updateWidgets', params),
  updateMeta: (params: {
    sectionId: string
    name?: string
    icon?: string
    order?: number
    type?: 'realtime' | 'evergreen'
    status?: 'active' | 'dormant' | 'archived'
    accentColor?: string
    enableComment?: boolean
    enableLike?: boolean
  }) =>
    callAdmin('section.updateMeta', params),
  updateStatus: (sectionId: string, status: 'active' | 'dormant' | 'archived') =>
    callAdmin('section.updateStatus', { sectionId, status }),
}

export const memberApi = {
  pendingList: (communityId: string) => callAdmin('member.pendingList', { communityId }),
  list: (params: { communityId: string; q?: string; status?: string }) => callAdmin('member.list', params),
  memberApprove: (communityId: string, memberId: string) =>
    callAdmin('member.approve', { communityId, memberId }),
  memberReject: (communityId: string, memberId: string) =>
    callAdmin('member.reject', { communityId, memberId }),
  kick: (communityId: string, memberId: string) =>
    callAdmin('member.kick', { communityId, memberId }),
}

export const approvalApi = {
  summary: () => callAdmin('admin.approvalSummary') as Promise<{
    pendingCommunityCount: number
    pendingMemberCount: number
    communities: Array<{ communityId: string; communityName: string; pendingMemberCount: number }>
  }>,
}

export const postAdminApi = {
  list: (params: {
    communityId: string
    sectionId?: string
    authorQuery?: string
    status?: 'active' | 'deleted' | 'all'
    dateFrom?: string
    dateTo?: string
  }) => callAdmin('post.listAdmin', params),
  get: (postId: string) => callAdmin('post.getAdmin', { postId }),
  delete: (postId: string) => callAdmin('post.deleteAdmin', { postId }),
  update: (postId: string, content: Record<string, any>) =>
    callAdmin('post.updateAdmin', { postId, content }),
  removeAttendanceMember: (params: { postId: string; widgetId: string; userId: string }) =>
    callAdmin('post.removeAttendanceMemberAdmin', params),
  createAdmin: (params: { communityId: string; sectionId: string; content: Record<string, any> }) =>
    callAdmin('post.createAdmin', params),
}

export interface UploadMetadata {
  cloudPath: string
  fileId: string
  url: string
  token: string
  authorization: string
  cosFileId: string
}

export type VideoUploadMetadata = UploadMetadata

export const videoApi = {
  requestUpload: (params: { fileName: string }) =>
    callAdmin('video.requestUpload', params) as Promise<UploadMetadata>,
}

export const audioApi = {
  requestUpload: (params: { fileName: string }) =>
    callAdmin('audio.requestUpload', params) as Promise<UploadMetadata>,
}

export const imageApi = {
  requestUpload: (params: { fileName: string }) =>
    callAdmin('image.requestUpload', params) as Promise<UploadMetadata>,
}

export const mediaApi = {
  getUrls: (fileIDs: string[]) =>
    callAdmin('media.getUrls', { fileIDs }) as Promise<{ urls: Record<string, string> }>,
}
