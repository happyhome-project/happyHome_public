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
  approve: (communityId: string) => callAdmin('community.approve', { communityId }),
  reject: (communityId: string) => callAdmin('community.reject', { communityId }),
}

export const sectionApi = {
  list: (communityId: string) => callAdmin('section.list', { communityId }),
  create: (params: { communityId: string; name: string; icon: string; order: number }) =>
    callAdmin('section.create', params),
  get: (sectionId: string) => callAdmin('section.get', { sectionId }),
  delete: (sectionId: string) => callAdmin('section.delete', { sectionId }),
  updateWidgets: (params: { sectionId: string; communityId: string; widgets: any[] }) =>
    callAdmin('section.updateWidgets', params),
}

export const memberApi = {
  pendingList: (communityId: string) => callAdmin('member.pendingList', { communityId }),
  memberApprove: (communityId: string, memberId: string) =>
    callAdmin('member.approve', { communityId, memberId }),
  memberReject: (communityId: string, memberId: string) =>
    callAdmin('member.reject', { communityId, memberId }),
}
