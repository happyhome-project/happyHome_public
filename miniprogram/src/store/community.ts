import { defineStore } from 'pinia'
import type { Community, Section } from '../../../cloud/shared/types'
import { memberApi, sectionApi } from '../api/cloud'

const STORAGE_KEY = 'community_store'
let communityMutationEpoch = 0
let loadingMyCommunities: { epoch: number; promise: Promise<void> } | null = null

interface LoadMyCommunitiesOptions {
  loadSections?: boolean
  shouldApply?: () => boolean
}

interface PendingCommunitySelection {
  targetCommunityId: string
  traceRequestId: string
  previousCommunityId: string
  previousBrowsingCommunity: Community | null
  previousSections: Section[]
  previousSectionIndex: number
}

export const useCommunityStore = defineStore('community', {
  state: () => ({
    currentCommunityId: '' as string,
    myCommunities: [] as Community[],
    browsingCommunity: null as Community | null,
    currentSections: [] as Section[],
    currentSectionIndex: 0,
    membershipByCommunity: {} as Record<string, { isMember: boolean; status: string | null; checkedAt: number }>,
    pendingCommunitySelection: null as PendingCommunitySelection | null,
  }),
  getters: {
    currentCommunity: (state): Community | undefined =>
      state.myCommunities.find(c => c._id === state.currentCommunityId) ||
      (state.browsingCommunity?._id === state.currentCommunityId ? state.browsingCommunity : undefined),
    currentSection: (state): Section | undefined =>
      state.currentSections[state.currentSectionIndex],
  },
  actions: {
    clearCommunityState() {
      communityMutationEpoch += 1
      this.currentCommunityId = ''
      this.myCommunities = []
      this.browsingCommunity = null
      this.currentSections = []
      this.currentSectionIndex = 0
      this.membershipByCommunity = {}
      this.pendingCommunitySelection = null
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
    async switchCommunity(communityId: string, expectedEpoch = communityMutationEpoch) {
      const res = await sectionApi.list(communityId)
      if (expectedEpoch !== communityMutationEpoch) return
      this.currentCommunityId = communityId
      this.currentSectionIndex = 0
      this.currentSections = res.sections as Section[]
      this.refreshMembershipStatus(communityId, expectedEpoch).catch(() => {})
      this.saveToStorage()
    },
    selectCommunityShell(communityId: string, communityShell?: Community, traceRequestId = '') {
      const targetCommunityId = String(communityId || '').trim()
      if (!targetCommunityId) return null
      if (targetCommunityId === this.currentCommunityId) {
        return this.pendingCommunitySelection?.targetCommunityId === targetCommunityId
          ? this.pendingCommunitySelection
          : null
      }
      communityMutationEpoch += 1
      const previousSelection = this.pendingCommunitySelection
      const selection: PendingCommunitySelection = {
        targetCommunityId,
        traceRequestId: String(traceRequestId || '').trim(),
        previousCommunityId: previousSelection
          ? previousSelection.previousCommunityId
          : this.currentCommunityId,
        previousBrowsingCommunity: previousSelection
          ? previousSelection.previousBrowsingCommunity
          : this.browsingCommunity,
        previousSections: previousSelection
          ? previousSelection.previousSections.slice()
          : this.currentSections.slice(),
        previousSectionIndex: previousSelection?.previousSectionIndex ?? this.currentSectionIndex,
      }
      this.pendingCommunitySelection = selection
      this.currentCommunityId = targetCommunityId
      this.browsingCommunity = this.myCommunities.find(
        (community) => community._id === targetCommunityId,
      ) || (communityShell?._id === targetCommunityId ? communityShell : null)
      this.currentSections = []
      this.currentSectionIndex = 0
      this.saveToStorage()
      return selection
    },
    confirmCommunitySelection(communityId: string) {
      const id = String(communityId || '').trim()
      if (this.pendingCommunitySelection?.targetCommunityId === id) {
        this.pendingCommunitySelection = null
      }
    },
    rollbackCommunitySelection(communityId: string) {
      const id = String(communityId || '').trim()
      const selection = this.pendingCommunitySelection
      if (!selection || selection.targetCommunityId !== id) return ''
      communityMutationEpoch += 1
      const previousStillActive = this.myCommunities.some(
        (community) => community._id === selection.previousCommunityId && community.status === 'active',
      )
      if (!previousStillActive) {
        this.currentCommunityId = ''
        this.browsingCommunity = null
        this.currentSections = []
        this.currentSectionIndex = 0
        this.pendingCommunitySelection = null
        this.saveToStorage()
        return ''
      }
      this.currentCommunityId = selection.previousCommunityId
      this.browsingCommunity = selection.previousBrowsingCommunity
      this.currentSections = selection.previousSections
      this.currentSectionIndex = selection.previousSectionIndex
      this.pendingCommunitySelection = null
      this.saveToStorage()
      return this.currentCommunityId
    },
    handleCommunityAccessLost(communityId: string) {
      const id = String(communityId || '').trim()
      if (!id) return ''
      this.myCommunities = this.myCommunities.filter((community) => community._id !== id)
      delete this.membershipByCommunity[id]
      const restoredId = this.rollbackCommunitySelection(id)
      if (restoredId) return restoredId
      if (this.currentCommunityId === id) {
        communityMutationEpoch += 1
        this.currentCommunityId = ''
        this.browsingCommunity = null
        this.currentSections = []
        this.currentSectionIndex = 0
        this.pendingCommunitySelection = null
        this.saveToStorage()
      }
      return ''
    },
    async refreshMembershipStatus(communityId: string, expectedEpoch = communityMutationEpoch) {
      const id = String(communityId || '').trim()
      if (!id) return
      try {
        const res = await memberApi.myStatus(id)
        if (expectedEpoch !== communityMutationEpoch) return
        this.membershipByCommunity[id] = {
          isMember: !!res.isMember,
          status: res.status,
          checkedAt: Date.now(),
        }
      } catch (_error) {
        if (expectedEpoch !== communityMutationEpoch) return
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
      const epoch = communityMutationEpoch
      if (loadingMyCommunities?.epoch === epoch) {
        await loadingMyCommunities.promise
        if (epoch !== communityMutationEpoch) return
        if (options.shouldApply && !options.shouldApply()) return
        if (options.loadSections !== false && this.currentCommunityId && this.currentSections.length === 0) {
          await this.switchCommunity(this.currentCommunityId, epoch)
        }
        return
      }
      const holder = {
        epoch,
        promise: this.loadMyCommunitiesFresh(options, epoch),
      }
      loadingMyCommunities = holder
      try {
        await holder.promise
      } finally {
        if (loadingMyCommunities === holder) loadingMyCommunities = null
      }
    },
    async loadMyCommunitiesFresh(options: LoadMyCommunitiesOptions = {}, expectedEpoch = communityMutationEpoch) {
      const res = await memberApi.myCommunities()
      if (expectedEpoch !== communityMutationEpoch) return
      if (options.shouldApply && !options.shouldApply()) return
      this.myCommunities = (res.communities as Community[]).filter(
        (community) => community?.status === 'active',
      )
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
        await this.switchCommunity(targetId, expectedEpoch)
      }
    },
  },
})
