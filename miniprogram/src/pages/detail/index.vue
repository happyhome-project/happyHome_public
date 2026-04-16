<template>
  <view class="detail-page">
    <view v-if="post && section" class="content">
      <view v-if="!editing">
        <WidgetRenderer
          v-for="widget in section.widgets"
          :key="widget.widgetId"
          :widget="widget"
          :content="post.content"
        />
      </view>
      <view v-else>
        <WidgetEditor
          v-for="widget in section.widgets"
          :key="widget.widgetId"
          :widget="widget"
          v-model="editContent[widget.widgetId]"
        />
      </view>
      <view class="meta">
        <text class="time">发布于 {{ formatDate(post.createdAt) }}</text>
        <view v-if="isAuthor" class="actions">
          <text v-if="!editing" class="edit-btn" @tap="startEdit">编辑</text>
          <text
            v-if="!editing"
            class="delete-btn"
            :class="{ disabled: deleteLock.busy.value }"
            @tap="deleteLock.run()"
          >{{ deleteLock.busy.value ? '删除中...' : '删除' }}</text>
          <text v-if="editing" class="cancel-btn" @tap="cancelEdit">取消</text>
          <text v-if="editing" class="save-btn" @tap="handleSaveEdit">
            {{ savingEdit ? '保存中...' : '保存' }}
          </text>
        </view>
      </view>
    </view>
    <view v-else class="loading"><text>加载中...</text></view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi, sectionApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import WidgetRenderer from '../../components/widgets/WidgetRenderer.vue'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'
import { useBusyLock } from '../../utils/useBusyLock'

const post = ref<any>(null)
const section = ref<any>(null)
const editing = ref(false)
const savingEdit = ref(false)
const editContent = reactive<Record<string, any>>({})
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

    if (!section.value && post.value?.sectionId) {
      const secRes = await sectionApi.get(post.value.sectionId)
      section.value = secRes.section ?? null
    }

    if (!section.value) {
      uni.showToast({ title: '板块信息加载失败', icon: 'none' })
      uni.navigateBack()
    }
  } catch (e) {
    uni.showToast({ title: '帖子不存在', icon: 'none' })
    uni.navigateBack()
  }
})

const deleteLock = useBusyLock(async () => {
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
})

function resetEditContent(content: Record<string, any>) {
  Object.keys(editContent).forEach((k) => delete editContent[k])
  const cloned = JSON.parse(JSON.stringify(content || {}))
  Object.assign(editContent, cloned)
}

function startEdit() {
  resetEditContent(post.value?.content || {})
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function uploadImages(tempPaths: string[]): Promise<string[]> {
  return Promise.all(tempPaths.map((path) => {
    if (path.startsWith('cloud://')) return Promise.resolve(path)
    const ext = path.split('.').pop() ?? 'jpg'
    const cloudPath = `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    return new Promise<string>((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: path,
        success: (res: any) => resolve(res.fileID),
        fail: reject,
      })
    })
  }))
}

async function handleSaveEdit() {
  if (!post.value || !section.value || savingEdit.value) return

  const content = JSON.parse(JSON.stringify(editContent || {}))
  for (const widget of section.value.widgets || []) {
    if (!widget.required) continue
    const value = content[widget.widgetId]
    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    if (isEmpty) {
      uni.showToast({ title: `请填写${widget.label}`, icon: 'none' })
      return
    }
  }

  savingEdit.value = true
  try {
    for (const widget of section.value.widgets || []) {
      if (widget.type === 'image_group' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadImages(content[widget.widgetId])
      }
    }

    const res = await postApi.update(post.value._id, content) as any
    post.value = {
      ...post.value,
      content,
      updatedAt: res.updatedAt || new Date().toISOString(),
    }
    editing.value = false
    uni.showToast({ title: '保存成功', icon: 'success' })
  } catch (e: any) {
    uni.showToast({ title: e?.message || '保存失败', icon: 'none' })
  } finally {
    savingEdit.value = false
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
.actions { display: flex; align-items: center; gap: 24rpx; }
.edit-btn { font-size: 26rpx; color: #1976d2; padding: 8rpx 20rpx; }
.delete-btn { font-size: 26rpx; color: #ff4444; padding: 8rpx 20rpx; }
.delete-btn.disabled { color: #ccc; pointer-events: none; }
.cancel-btn { font-size: 26rpx; color: #999; padding: 8rpx 20rpx; }
.save-btn { font-size: 26rpx; color: #2e7d32; padding: 8rpx 20rpx; }
</style>
