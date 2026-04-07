<template>
  <view class="detail-page">
    <view v-if="post && section" class="content">
      <WidgetRenderer
        v-for="widget in section.widgets"
        :key="widget.widgetId"
        :widget="widget"
        :content="post.content"
      />
      <view class="meta">
        <text class="time">发布于 {{ formatDate(post.createdAt) }}</text>
        <text v-if="isAuthor" class="delete-btn" @tap="handleDelete">删除</text>
      </view>
    </view>
    <view v-else class="loading"><text>加载中...</text></view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import WidgetRenderer from '../../components/widgets/WidgetRenderer.vue'

const post = ref<any>(null)
const section = ref<any>(null)
const communityStore = useCommunityStore()
const userStore = useUserStore()

const isAuthor = computed(() => post.value?.authorId === userStore.openId)

onLoad(async (options: any) => {
  const postId = options?.postId
  if (!postId) return
  try {
    const res = await postApi.get(postId)
    post.value = res.post
    section.value = communityStore.currentSections.find(
      (s: any) => s._id === post.value?.sectionId
    ) ?? null
  } catch (e) {
    uni.showToast({ title: '帖子不存在', icon: 'none' })
    uni.navigateBack()
  }
})

async function handleDelete() {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '确认删除',
      content: '删除后不可恢复',
      success: (res) => resolve(res.confirm),
    })
  })
  if (!confirmed) return
  try {
    await postApi.delete(post.value._id)
    uni.showToast({ title: '已删除', icon: 'success' })
    uni.navigateBack()
  } catch (e: any) {
    uni.showToast({ title: e?.message || '删除失败', icon: 'none' })
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`
}
</script>

<style scoped>
.detail-page { padding: 32rpx; background: #fff; min-height: 100vh; }
.loading { text-align: center; padding: 80rpx; color: #999; }
.meta { margin-top: 40rpx; padding-top: 20rpx; border-top: 1rpx solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
.time { font-size: 24rpx; color: #bbb; }
.delete-btn { font-size: 26rpx; color: #ff4444; padding: 8rpx 20rpx; }
</style>
