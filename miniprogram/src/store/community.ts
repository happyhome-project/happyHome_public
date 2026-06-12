import { defineStore } from 'pinia'
import type { Community, Section } from '../../../cloud/shared/types'
import { memberApi, sectionApi } from '../api/cloud'

const STORAGE_KEY = 'community_store'
let loadingMyCommunities: Promise<void> | null = null

interface LoadMyCommunitiesOptions {
  loadSections?: boolean
}

export const useCommunityStore = defineStore('community', {
  state: () => ({
    currentCommunityId: '' as string,
    myCommunities: [] as Community[],
    currentSections: [] as Section[],
    currentSectionIndex: 0,
    membershipByCommunity: {} as Record<string, { isMember: boolean; status: string | null; checkedAt: number }>,
  }),
  getters: {
    currentCommunity: (state): Community | undefined =>
      state.myCommunities.find(c => c._id === state.currentCommunityId),
    currentSection: (state): Section | undefined =>
      state.currentSections[state.currentSectionIndex],
  },
  actions: {
    clearCommunityState() {
      this.currentCommunityId = ''
      this.currentSections = []
      this.currentSectionIndex = 0
      this.saveToStorage()
    },
    loadFromStorage() {
      try {
        const saved = wx.getStorageSync(STORAGE_KEY)
        if (saved) {
          this.currentCommunityId = saved.currentCommunityId || ''
          this.currentSectionIndex = saved.currentSectionIndex || 0
        }
      } catch (_error) {}
    },
    saveToStorage() {
      try {
        wx.setStorageSync(STORAGE_KEY, {
          currentCommunityId: this.currentCommunityId,
          currentSectionIndex: this.currentSectionIndex,
        })
      } catch (_error) {}
    },
    async switchCommunity(communityId: string) {
      this.currentCommunityId = communityId
      this.currentSectionIndex = 0
      const res = await sectionApi.list(communityId)
      this.currentSections = res.sections as Section[]
      this.refreshMembershipStatus(communityId).catch(() => {})
      this.saveToStorage()
    },
    async refreshMembershipStatus(communityId: string) {
      const id = String(communityId || '').trim()
      if (!id) return
      try {
        const res = await memberApi.myStatus(id)
        this.membershipByCommunity[id] = {
          isMember: !!res.isMember,
          status: res.status,
          checkedAt: Date.now(),
        }
      } catch (_error) {
        this.membershipByCommunity[id] = {
          isMember: false,
          status: null,
          checkedAt: Date.now(),
        }
      }
    },
    getMembershipStatus(communityId: string) {
      return this.membershipByCommunity[String(communityId || '').trim()] || null
    },
    async loadMyCommunities(options: LoadMyCommunitiesOptions = {}) {
      if (loadingMyCommunities) {
        await loadingMyCommunities
        if (options.loadSections !== false && this.currentCommunityId && this.currentSections.length === 0) {
          await this.switchCommunity(this.currentCommunityId)
        }
        return
      }
      loadingMyCommunities = this.loadMyCommunitiesFresh(options)
      try {
        await loadingMyCommunities
      } finally {
        loadingMyCommunities = null
      }
    },
    async loadMyCommunitiesFresh(options: LoadMyCommunitiesOptions = {}) {
      const res = await memberApi.myCommunities()
      this.myCommunities = res.communities as Community[]
      if (this.myCommunities.length === 0) {
        this.clearCommunityState()
        return
      }
      const targetId = this.currentCommunityId &&
        this.myCommunities.some(c => c._id === this.currentCommunityId)
        ? this.currentCommunityId
        : this.myCommunities[0]._id
      this.currentCommunityId = targetId
      this.currentSectionIndex = 0
      this.saveToStorage()
      if (options.loadSections !== false) {
        await this.switchCommunity(targetId)
      }
    },
  },
})
