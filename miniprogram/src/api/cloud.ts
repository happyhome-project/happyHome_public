// Wraps wx.cloud.callFunction with unified error handling
export async function callCloud<T = any>(
  name: string, action: string, params: object = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: { action, params },
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
}

export const postApi = {
  list: (sectionId: string, skip = 0) =>
    callCloud<{ posts: any[] }>('post', 'list', { sectionId, skip }),
  get: (postId: string) =>
    callCloud<{ post: any }>('post', 'get', { postId }),
  create: (params: object) =>
    callCloud('post', 'create', params),
  delete: (postId: string) =>
    callCloud('post', 'delete', { postId }),
}
