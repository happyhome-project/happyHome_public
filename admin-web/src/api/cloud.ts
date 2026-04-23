import axios from 'axios'

const BASE_URL = import.meta.env.VITE_CLOUD_API_URL

async function callAdmin(action: string, params: Record<string, any> = {}) {
  const res = await axios.post(
    `${BASE_URL}/admin`,
    { action, ...params },
    { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
  )
  return res.data
}

// Keep for backward compat with WidgetEditor.vue which imports callCloud
export const callCloud = callAdmin

export const communityApi = {
  list: () => callAdmin('community.list'),
  listDisabled: () => callAdmin('community.listDisabled'),
  approve: (communityId: string) => callAdmin('community.approve', { communityId }),
  reject: (communityId: string) => callAdmin('community.reject', { communityId }),
  disable: (communityId: string) => callAdmin('community.disable', { communityId }),
  restore: (communityId: string) => callAdmin('community.restore', { communityId }),
  hardDelete: (communityId: string) => callAdmin('community.hardDelete', { communityId }),
  updateMeta: (params: { communityId: string; name?: string; description?: string; motto?: string; mottoCite?: string }) =>
    callAdmin('community.updateMeta', params),
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
  removeAttendanceMember: (params: { postId: string; widgetId: string; userId: string }) =>
    callAdmin('post.removeAttendanceMemberAdmin', params),
}
