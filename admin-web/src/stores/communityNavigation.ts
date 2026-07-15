import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { approvalApi, communityApi } from '../api/cloud'

export interface CommunityNavigationItem {
  id: string
  name: string
  pendingMemberCount: number
}

const EXPANDED_KEY = 'happyhome.admin.communityNavigation.expanded.v1'

function readExpanded() {
  if (typeof window === 'undefined') return [] as string[]
  try { return JSON.parse(window.localStorage.getItem(EXPANDED_KEY) || '[]') as string[] } catch { return [] }
}

export const useCommunityNavigationStore = defineStore('communityNavigation', () => {
  const communities = ref<CommunityNavigationItem[]>([])
  const expandedCommunityIds = ref<string[]>(readExpanded())
  const loading = ref(false)
  const expandedSet = computed(() => new Set(expandedCommunityIds.value))

  async function refresh() {
    loading.value = true
    try {
      const [communityRes, summaryRes] = await Promise.all([
        communityApi.list() as Promise<any>,
        approvalApi.summary().catch(() => ({ communities: [] })) as Promise<any>,
      ])
      const pending = new Map((summaryRes.communities || []).map((item: any) => [String(item.communityId), Number(item.pendingMemberCount || 0)]))
      communities.value = (communityRes.communities || [])
        .filter((item: any) => item.status === 'active')
        .map((item: any) => ({
          id: String(item._id || item.id || ''),
          name: String(item.name || '未命名社区'),
          pendingMemberCount: pending.get(String(item._id || item.id || '')) || 0,
        }))
        .filter((item: CommunityNavigationItem) => item.id)
    } finally {
      loading.value = false
    }
  }

  function ensureExpanded(communityId: string) {
    if (!communityId || expandedSet.value.has(communityId)) return
    expandedCommunityIds.value = [...expandedCommunityIds.value, communityId]
    persist()
  }

  function toggle(communityId: string) {
    expandedCommunityIds.value = expandedSet.value.has(communityId)
      ? expandedCommunityIds.value.filter(id => id !== communityId)
      : [...expandedCommunityIds.value, communityId]
    persist()
  }

  function persist() {
    if (typeof window !== 'undefined') window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedCommunityIds.value))
  }

  return { communities, expandedCommunityIds, expandedSet, loading, refresh, ensureExpanded, toggle }
})
