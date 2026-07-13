export interface HomeLoadingRef {
  value: boolean
}

export type HomeLoadingOwner = symbol

export function createHomeLoadingGate(loading: HomeLoadingRef) {
  let activeOwner: HomeLoadingOwner | null = null

  return {
    releaseInitial() {
      if (activeOwner) return false
      loading.value = false
      return true
    },
    beginRefresh() {
      const owner = Symbol('home-loading-refresh')
      activeOwner = owner
      loading.value = true
      return owner
    },
    endRefresh(owner: HomeLoadingOwner) {
      if (activeOwner !== owner) return false
      activeOwner = null
      loading.value = false
      return true
    },
  }
}
