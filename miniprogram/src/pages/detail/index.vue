<template>
  <view class="detail-page">
    <view v-if="post && section" class="content">
      <view v-if="!editing">
        <WidgetRenderer
          v-for="widget in regularWidgets"
          :key="widget.widgetId"
          :widget="widget"
          :content="post.content"
        />

        <view v-for="widget in attendanceWidgets" :key="widget.widgetId" class="attendance-card">
          <view class="attendance-head">
            <text class="attendance-label">{{ widget.label }}</text>
            <text class="attendance-count">
              {{ getAttendanceSummary(widget).count }}人参与
              <text v-if="getAttendanceSummary(widget).capacity"> / {{ getAttendanceSummary(widget).capacity }}人</text>
            </text>
          </view>

          <button
            class="attendance-btn"
            :class="{
              joined: getAttendanceSummary(widget).isJoined,
              full: getAttendanceSummary(widget).isFull && !getAttendanceSummary(widget).isJoined,
            }"
            :disabled="joiningWidgetId === widget.widgetId || (getAttendanceSummary(widget).isFull && !getAttendanceSummary(widget).isJoined)"
            @tap="toggleAttendance(widget)"
          >
            {{
              joiningWidgetId === widget.widgetId
                ? '处理中...'
                : getAttendanceSummary(widget).isJoined
                  ? '已参与，可取消'
                  : getAttendanceSummary(widget).isFull
                    ? '已满员'
                    : '参与'
            }}
          </button>

          <view class="attendance-preview" @tap="openRoster(widget)">
            <view class="attendance-avatars">
              <image
                v-for="user in getAttendanceSummary(widget).previewUsers"
                :key="user.userId"
                :src="user.avatarUrl || fallbackAvatar"
                class="avatar"
                mode="aspectFill"
              />
              <view v-if="getAttendanceSummary(widget).previewUsers.length === 0" class="empty-avatar">暂无</view>
            </view>
            <text class="attendance-roster-link">查看参与名单</text>
          </view>
        </view>
      </view>

      <view v-else>
        <WidgetEditor
          v-for="widget in regularWidgets"
          :key="widget.widgetId"
          :widget="widget"
          v-model="editContent[widget.widgetId]"
        />
        <view v-for="widget in attendanceWidgets" :key="widget.widgetId" class="attendance-hint">
          <text class="attendance-label">{{ widget.label }}</text>
          <text class="attendance-hint-text">活动参与人数由成员在帖子详情中点击参与后自动统计。</text>
        </view>
      </view>

      <view class="meta">
        <view>
          <text class="time">发布于 {{ formatDate(post.createdAt) }}</text>
          <view class="section-flags">
            <text class="flag">{{ section.enableComment !== false ? '评论开启' : '评论关闭' }}</text>
            <text class="flag">{{ section.enableLike !== false ? '点赞开启' : '点赞关闭' }}</text>
          </view>
        </view>
        <view v-if="isAuthor" class="actions">
          <text v-if="!editing" class="edit-btn" @tap="startEdit">编辑</text>
          <text
            v-if="!editing"
            class="delete-btn"
            :class="{ disabled: deleteLock.busy.value }"
            @tap="deleteLock.run()"
          >{{ deleteLock.busy.value ? '删除中...' : '删除' }}</text>
          <text v-if="editing" class="cancel-btn" @tap="cancelEdit">取消</text>
          <text v-if="editing" class="save-btn" @tap="handleSaveEdit">{{ savingEdit ? '保存中...' : '保存' }}</text>
        </view>
      </view>
    </view>

    <view v-else class="loading"><text>加载中...</text></view>

    <view v-if="showRoster" class="roster-mask" @tap="closeRoster">
      <view class="roster-panel" @tap.stop>
        <view class="roster-header">
          <view>
            <text class="roster-title">{{ rosterTitle }}</text>
            <text class="roster-subtitle">
              {{ rosterMeta.total }}人参与
              <text v-if="rosterMeta.capacity"> / {{ rosterMeta.capacity }}人</text>
            </text>
          </view>
          <text class="roster-close" @tap="closeRoster">关闭</text>
        </view>
        <scroll-view scroll-y class="roster-list">
          <view v-for="member in rosterMembers" :key="`${member.userId}-${member.joinedAt}`" class="roster-item">
            <image :src="member.avatarUrl || fallbackAvatar" class="roster-avatar" mode="aspectFill" />
            <view class="roster-info">
              <text class="roster-name">{{ member.nickName || member.userId }}</text>
              <text class="roster-time">{{ formatDateTime(member.joinedAt) }}</text>
            </view>
          </view>
          <view v-if="rosterMembers.length === 0" class="roster-empty">还没有人参与</view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi, sectionApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'
import WidgetRenderer from '../../components/widgets/WidgetRenderer.vue'
import { useBusyLock } from '../../utils/useBusyLock'

const fallbackAvatar = '/static/default-avatar.png'
const post = ref<any>(null)
const section = ref<any>(null)
const editing = ref(false)
const savingEdit = ref(false)
const joiningWidgetId = ref('')
const currentPostId = ref('')
const editContent = reactive<Record<string, any>>({})
const showRoster = ref(false)
const rosterMembers = ref<any[]>([])
const rosterTitle = ref('')
const rosterMeta = reactive({ total: 0, capacity: undefined as number | undefined })
const communityStore = useCommunityStore()
const userStore = useUserStore()

const isAuthor = computed(() => post.value?.authorId === userStore.openId)
const regularWidgets = computed(() => (section.value?.widgets || []).filter((widget: any) => widget.type !== 'attendance'))
const attendanceWidgets = computed(() => (section.value?.widgets || []).filter((widget: any) => widget.type === 'attendance'))

onLoad(async (options: any) => {
  const postId = String(options?.postId || '')
  if (!postId) return
  currentPostId.value = postId
  await loadPost(postId)
})

async function loadPost(postId: string) {
  try {
    const res = await postApi.get(postId)
    post.value = res.post
    section.value = communityStore.currentSections.find((item: any) => item._id === post.value?.sectionId) ?? null

    if (!section.value && post.value?.sectionId) {
      const sectionRes = await sectionApi.get(post.value.sectionId)
      section.value = sectionRes.section ?? null
    }

    if (!section.value) {
      uni.showToast({ title: '板块信息加载失败', icon: 'none' })
      uni.navigateBack()
    }
  } catch {
    uni.showToast({ title: '帖子不存在', icon: 'none' })
    uni.navigateBack()
  }
}

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
  } catch (error: any) {
    uni.showToast({ title: error?.message || '删除失败', icon: 'none' })
  }
})

function resetEditContent(content: Record<string, any>) {
  Object.keys(editContent).forEach((key) => delete editContent[key])
  const cloned = JSON.parse(JSON.stringify(content || {}))
  const validWidgetIds = new Set(regularWidgets.value.map((widget: any) => widget.widgetId))
  Object.entries(cloned).forEach(([key, value]) => {
    if (validWidgetIds.has(key)) {
      editContent[key] = value
    }
  })
}

function startEdit() {
  resetEditContent(post.value?.content || {})
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function getAttendanceSummary(widget: any) {
  return post.value?.attendanceSummaryByWidget?.[widget.widgetId] || {
    count: 0,
    isFull: false,
    isJoined: false,
    previewUsers: [],
  }
}

async function toggleAttendance(widget: any) {
  if (!post.value || joiningWidgetId.value) return
  joiningWidgetId.value = widget.widgetId
  try {
    const summary = getAttendanceSummary(widget)
    if (summary.isJoined) {
      await postApi.leaveAttendance(post.value._id, widget.widgetId)
    } else {
      await postApi.joinAttendance(post.value._id, widget.widgetId)
    }
    await loadPost(currentPostId.value)
  } catch (error: any) {
    uni.showToast({ title: error?.message || '操作失败', icon: 'none' })
  } finally {
    joiningWidgetId.value = ''
  }
}

async function openRoster(widget: any) {
  if (!post.value) return
  try {
    const res = await postApi.listAttendanceMembers(post.value._id, widget.widgetId)
    rosterMembers.value = res.members || []
    rosterTitle.value = widget.label || '参与名单'
    rosterMeta.total = Number(res.total || 0)
    rosterMeta.capacity = res.capacity
    showRoster.value = true
  } catch (error: any) {
    uni.showToast({ title: error?.message || '加载名单失败', icon: 'none' })
  }
}

function closeRoster() {
  showRoster.value = false
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
  for (const widget of regularWidgets.value) {
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
    for (const widget of regularWidgets.value) {
      if (widget.type === 'image_group' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadImages(content[widget.widgetId])
      }
    }

    const res = await postApi.update(post.value._id, content) as any
    const validWidgetIds = new Set(regularWidgets.value.map((widget: any) => widget.widgetId))
    const sanitizedContent = Object.fromEntries(
      Object.entries(content).filter(([key]) => validWidgetIds.has(key))
    )
    post.value = {
      ...post.value,
      content: sanitizedContent,
      updatedAt: res.updatedAt || new Date().toISOString(),
    }
    editing.value = false
    uni.showToast({ title: '保存成功', icon: 'success' })
    await loadPost(currentPostId.value)
  } catch (error: any) {
    uni.showToast({ title: error?.message || '保存失败', icon: 'none' })
  } finally {
    savingEdit.value = false
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style lang="scss" scoped>
.detail-page {
  padding: $hh-space-lg;
  background: $hh-color-bg;
  min-height: 100vh;
}

.loading {
  text-align: center;
  padding: $hh-space-xxl;
  color: $hh-color-text-mute;
}

.attendance-card {
  margin-top: $hh-space-lg;
  padding: $hh-space-lg;
  border-radius: $hh-radius-md;
  background: linear-gradient(180deg, #f4f9ff 0%, #ffffff 100%);
  box-shadow: $hh-shadow-card;
}

.attendance-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $hh-space-md;
}

.attendance-label {
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
  font-weight: $hh-font-weight-medium;
}

.attendance-count {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.attendance-btn {
  margin-top: $hh-space-md;
  width: 100%;
  background: #2f80ed;
  color: #fff;
  border-radius: 999rpx;
  border: none;
  font-size: $hh-font-body;
}

.attendance-btn.joined {
  background: #12b886;
}

.attendance-btn.full {
  background: #c8d1dc;
}

.attendance-preview {
  margin-top: $hh-space-md;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $hh-space-md;
}

.attendance-avatars {
  display: flex;
  align-items: center;
  min-height: 56rpx;
}

.avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 2rpx solid #fff;
  margin-left: -12rpx;
  background: #edf2f7;
}

.avatar:first-child {
  margin-left: 0;
}

.empty-avatar {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.attendance-roster-link {
  font-size: $hh-font-caption;
  color: #2f80ed;
}

.attendance-hint {
  margin-bottom: $hh-space-lg;
  padding: $hh-space-md;
  border-radius: $hh-radius-md;
  background: #f4f8ff;
}

.attendance-hint-text {
  display: block;
  margin-top: $hh-space-xs;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.meta {
  margin-top: $hh-space-xl;
  padding-top: $hh-space-md;
  border-top: 1rpx solid $hh-color-divider;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.time {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.section-flags {
  display: flex;
  gap: $hh-space-sm;
  margin-top: $hh-space-xs;
}

.flag {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  background: $hh-color-bg-sub;
  padding: 4rpx 12rpx;
  border-radius: $hh-radius-full;
}

.actions {
  display: flex;
  align-items: center;
  gap: $hh-space-md;
}

.edit-btn {
  font-size: $hh-font-caption;
  color: $hh-color-info;
  padding: $hh-space-xs $hh-space-md;
}

.delete-btn {
  font-size: $hh-font-caption;
  color: $hh-color-danger;
  padding: $hh-space-xs $hh-space-md;
}

.delete-btn.disabled {
  color: $hh-color-text-mute;
  pointer-events: none;
}

.cancel-btn {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  padding: $hh-space-xs $hh-space-md;
}

.save-btn {
  font-size: $hh-font-caption;
  color: $hh-color-success;
  padding: $hh-space-xs $hh-space-md;
}

.roster-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.46);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 20;
}

.roster-panel {
  width: 100%;
  max-height: 70vh;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: $hh-space-lg;
}

.roster-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: $hh-space-md;
}

.roster-title {
  display: block;
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
  font-weight: $hh-font-weight-medium;
}

.roster-subtitle {
  display: block;
  margin-top: $hh-space-xs;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.roster-close {
  font-size: $hh-font-caption;
  color: #2f80ed;
}

.roster-list {
  max-height: 56vh;
  margin-top: $hh-space-lg;
}

.roster-item {
  display: flex;
  align-items: center;
  gap: $hh-space-md;
  padding: $hh-space-sm 0;
}

.roster-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #edf2f7;
}

.roster-info {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.roster-name {
  font-size: $hh-font-body;
  color: $hh-color-text;
}

.roster-time {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.roster-empty {
  padding: $hh-space-xl 0;
  text-align: center;
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
}
</style>
