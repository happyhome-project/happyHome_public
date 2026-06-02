export type ProfileCommunityLike = {
  _id?: string
}

export type PendingListResult = {
  members: any[]
}

export async function loadAdminPendingState(
  communities: ProfileCommunityLike[],
  pendingList: (communityId: string) => Promise<PendingListResult>,
) {
  const pendingMembers: any[] = []
  const adminCommunityIds: string[] = []

  for (const community of communities) {
    const communityId = String(community?._id || '')
    if (!communityId) continue
    try {
      const res = await pendingList(communityId)
      adminCommunityIds.push(communityId)
      if (Array.isArray(res.members) && res.members.length > 0) {
        pendingMembers.push(...res.members.map((member: any) => ({ ...member, communityId })))
      }
    } catch {
      // pendingList only succeeds for communities this user can administer.
    }
  }

  return { pendingMembers, adminCommunityIds }
}
