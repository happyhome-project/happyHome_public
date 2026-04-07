import { defineStore } from 'pinia'
import { communityApi, sectionApi } from '../api/cloud'

export const useCommunityStore = defineStore('community', {
  state: () => ({
    currentCommunityId: '' as string,
    myCommunities: [] as any[],
    currentSections: [] as any[],
    currentSectionIndex: 0,
  }),
  getters: {
    currentCommunity: (state) =>
      state.myCommunities.find((c: any) => c._id === state.currentCommunityId),
    currentSection: (state) =>
      state.currentSections[state.currentSectionIndex],
  },
  actions: {
    async switchCommunity(communityId: string) {
      this.currentCommunityId = communityId
      this.currentSectionIndex = 0
      const res = await sectionApi.list(communityId)
      this.currentSections = res.sections
    },
    async loadMyCommunities() {
      const res = await communityApi.list(false)
      this.myCommunities = res.communities
      if (this.myCommunities.length > 0 && !this.currentCommunityId) {
        await this.switchCommunity(this.myCommunities[0]._id)
      }
    },
  },
})
