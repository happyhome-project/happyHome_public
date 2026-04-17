<template>
  <view class="page">
    <view class="top-bar">
      <view class="community-name" @tap="showSwitcher = true">
        <text>{{ communityStore.currentCommunity?.name ?? '选择社区' }}</text>
        <text class="arrow"> ▾</text>
      </view>
    </view>

    <SectionTabs
      v-if="communityStore.currentSections.length > 0"
      :sections="communityStore.currentSections"
      :current-index="communityStore.currentSectionIndex"
      @change="handleSectionChange"
    />

    <scroll-view
      scroll-y
      class="feed"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="refresh"
      @scrolltolower="loadMore"
    >
      <view v-if="communityStore.myCommunities.length === 0" class="empty-state">
        <text>还没有加入社区</text>
        <button size="mini" @tap="goOnboarding">去加入</button>
      </view>
      <view v-else-if="posts.length === 0 && !loading" class="empty-state">
        <text>暂无内容，来发第一帖吧</text>
      </view>
      <PostCard
        v-for="post in posts"
        :key="post._id"
        :post="post"
        :section="communityStore.currentSection"
        @tap="goDetail(post._id)"
      />
      <view v-if="loading" class="loading"><text>加载中...</text></view>
    </scroll-view>

    <!-- Community switcher modal -->
    <view v-if="showSwitcher" class="switcher-mask" @tap="showSwitcher = false">
      <view class="switcher-panel" @tap.stop>
        <view
          v-for="c in communityStore.myCommunities"
          :key="c._id"
          class="switcher-item"
          :class="{ active: c._id === communityStore.currentCommunityId }"
          @tap="switchCommunity(c._id)"
        >
          <text>{{ c.name }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useCommunityStore } from '../../store/community'
import { postApi } from '../../api/cloud'
import SectionTabs from '../../components/SectionTabs.vue'
import PostCard from '../../components/PostCard.vue'

const communityStore = useCommunityStore()
const posts = ref<any[]>([])
const loading = ref(false)
const refreshing = ref(false)
const hasMore = ref(true)
const showSwitcher = ref(false)

async function loadPosts(reset = false) {
  if (!communityStore.currentSection || loading.value) return
  loading.value = true
  try {
    const skip = reset ? 0 : posts.value.length
    const res = await postApi.list(communityStore.currentSection._id, skip)
    const newPosts = res.posts
    posts.value = reset ? newPosts : [...posts.value, ...newPosts]
    hasMore.value = newPosts.length === 20
  } catch (e) {
    uni.showToast({ title: '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function handleSectionChange(index: number) {
  communityStore.currentSectionIndex = index
  await loadPosts(true)
}

async function refresh() {
  refreshing.value = true
  await loadPosts(true)
  refreshing.value = false
}

function loadMore() {
  if (hasMore.value && !loading.value) loadPosts()
}

function goDetail(postId: string) {
  uni.navigateTo({ url: `/pages/detail/index?postId=${postId}` })
}

async function switchCommunity(communityId: string) {
  showSwitcher.value = false
  await communityStore.switchCommunity(communityId)
  await loadPosts(true)
}

function goOnboarding() {
  uni.reLaunch({ url: '/pages/onboarding/index' })
}

onMounted(async () => {
  if (communityStore.myCommunities.length === 0) {
    await communityStore.loadMyCommunities()
  }
  await loadPosts(true)
})

watch(() => communityStore.currentSectionIndex, () => loadPosts(true))
</script>

<style lang="scss" scoped>
.page { height: 100vh; display: flex; flex-direction: column; background: $hh-color-bg-sub; }
.top-bar { padding: $hh-space-md $hh-space-lg; background: $hh-color-surface; border-bottom: 1rpx solid $hh-color-divider; }
.community-name { font-size: $hh-font-h3; font-weight: $hh-font-weight-bold; color: $hh-color-text; }
.arrow { font-size: $hh-font-caption; color: $hh-color-text-mute; }
.feed { flex: 1; padding: $hh-space-sm; }
.empty-state { text-align: center; padding: $hh-space-xxl 0; color: $hh-color-text-mute; font-size: $hh-font-body; }
.loading { text-align: center; padding: $hh-space-md; color: $hh-color-text-mute; font-size: $hh-font-caption; }
.switcher-mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: $hh-color-mask; z-index: $hh-z-overlay;
  display: flex; align-items: flex-start; justify-content: flex-start;
}
.switcher-panel {
  background: $hh-color-surface; margin: 120rpx 0 0 0; width: 300rpx;
  border-radius: 0 $hh-radius-md $hh-radius-md 0; overflow: hidden;
  box-shadow: $hh-shadow-float;
}
.switcher-item { padding: $hh-space-lg; font-size: $hh-font-body-lg; color: $hh-color-text-sub; border-bottom: 1rpx solid $hh-color-divider; }
.switcher-item.active { color: $hh-color-text; font-weight: $hh-font-weight-bold; background: $hh-color-bg-sub; }
</style>
