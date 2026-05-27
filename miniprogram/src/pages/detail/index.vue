<template>
  <view class="detail-page">
    <LoginGuard
      v-if="!userStore.isLoggedIn"
      title="请先登录"
      desc="登录后才能查看帖子详情"
    />
    <view v-else-if="post && section" class="content">
      <view v-if="!editing">
        <WidgetRenderer
          v-for="widget in regularWidgets"
          :key="widget.widgetId"
          :widget="widget"
          :content="post.content"
          :post-meta="postMeta"
        />

        <view
          v-for="widget in attendanceWidgets"
          :key="widget.widgetId"
          class="attendance-card"
          :class="attendanceCardClass(widget)"
          @tap="openRoster(widget)"
        >
          <view class="attendance-head">
            <view class="attendance-title">
              <text class="attendance-count">{{ getAttendanceSummary(widget).occupiedSeats || 0 }}<text v-if="getAttendanceSummary(widget).capacity">/{{ getAttendanceSummary(widget).capacity }}</text></text>
              <template v-if="resolveAttendanceWidgetLabel(widget)">
                <text class="attendance-sep"> · </text>
                <text class="attendance-label">{{ resolveAttendanceWidgetLabel(widget) }}</text>
              </template>
            </view>
            <text
              class="attendance-tag"
              :class="attendanceTagClass(widget)"
              @tap.stop="handleAttendanceAction(widget)"
            >{{ attendanceTagText(widget) }} ›</text>
          </view>

          <view class="hh-avatar-stack">
            <view
              v-for="user in getAttendanceSummary(widget).previewUsers"
              :key="user.userId"
              class="hh-avatar-slot"
              :class="{ 'is-self': user.userId === userStore.openId }"
            >
              <image
                :src="user.userId === userStore.openId ? (userStore.avatarUrl || user.avatarUrl || fallbackAvatar) : (user.avatarUrl || fallbackAvatar)"
                class="hh-avatar-img"
                mode="aspectFill"
              />
              <text v-if="(user.seatCount || 1) >= 2" class="hh-avatar-badge">{{ user.seatCount }}</text>
            </view>
            <view
              v-for="n in emptySlotCount(widget)"
              :key="'empty-' + widget.widgetId + '-' + n"
              class="hh-avatar-slot hh-avatar-slot--empty"
            >
              <text class="hh-avatar-empty-mark">＋</text>
            </view>
            <view v-if="!getAttendanceSummary(widget).previewUsers.length && !emptySlotCount(widget)" class="hh-avatar-empty-text">暂无</view>
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
          <text v-if="resolveAttendanceWidgetLabel(widget)" class="attendance-label">{{ resolveAttendanceWidgetLabel(widget) }}</text>
          <text class="attendance-hint-text">活动参与人数由成员在帖子详情中点击参与后自动统计。</text>
        </view>
      </view>

      <view class="meta">
        <view>
          <text class="time">发布于 {{ formatDate(post.createdAt) }}</text>
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

    <view v-else-if="userStore.isLoggedIn" class="loading"><text>加载中...</text></view>

    <view v-if="showRoster" class="roster-mask" @tap="closeRoster">
      <view class="roster-panel" @tap.stop>
        <view class="roster-header">
          <view>
            <text class="roster-title">{{ rosterTitle }}</text>
            <text class="roster-subtitle">
              {{ rosterMeta.occupiedSeats }}<text v-if="rosterMeta.capacity">/{{ rosterMeta.capacity }}</text> 席
              <text v-if="rosterMeta.total !== rosterMeta.occupiedSeats"> · 共 {{ rosterMeta.total }} 组</text>
            </text>
          </view>
          <view class="roster-actions">
            <text
              v-if="rosterSelfJoined"
              class="roster-cancel"
              :class="{ disabled: cancelBusy }"
              @tap="handleCancelInSheet"
            >{{ cancelBusy ? '取消中...' : '取消参与' }}</text>
            <text class="roster-close" @tap="closeRoster">关闭</text>
          </view>
        </view>
        <scroll-view scroll-y class="roster-list">
          <view v-for="member in rosterMembers" :key="`${member.userId}-${member.joinedAt}`" class="roster-item">
            <image :src="member.avatarUrl || fallbackAvatar" class="roster-avatar" mode="aspectFill" />
            <view class="roster-info">
              <text class="roster-name">
                {{ member.nickName || member.userId }}
                <text v-if="(member.seatCount || 1) >= 2" class="roster-companion">（+{{ (member.seatCount || 1) - 1 }} 位同伴）</text>
              </text>
              <text class="roster-time">{{ formatDateTime(member.joinedAt) }}</text>
            </view>
          </view>
          <view v-if="rosterMembers.length === 0" class="roster-empty">还没有人参与</view>
        </scroll-view>
      </view>
    </view>
    <FloatingPlayer />
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi, sectionApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import LoginGuard from '../../components/LoginGuard.vue'
import FloatingPlayer from '../../components/FloatingPlayer/FloatingPlayer.vue'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'
import WidgetRenderer from '../../components/widgets/WidgetRenderer.vue'
import { useBusyLock, useKeyedBusyLock } from '../../utils/useBusyLock'
import { resolveAttendanceWidgetLabel } from '../../utils/widget-form'

const fallbackAvatar = '/static/default-avatar.png'
const ATTENDANCE_SLOT_DISPLAY_MAX = 6

const post = ref<any>(null)
const section = ref<any>(null)
const editing = ref(false)
const savingEdit = ref(false)
const currentPostId = ref('')
const editContent = reactive<Record<string, any>>({})
const showRoster = ref(false)
const rosterMembers = ref<any[]>([])
const rosterTitle = ref('')
const rosterWidgetId = ref('')
const rosterMeta = reactive({
  total: 0,
  occupiedSeats: 0,
  capacity: undefined as number | undefined,
})
const cancelBusy = ref(false)
const communityStore = useCommunityStore()
const userStore = useUserStore()

const rosterSelfJoined = computed(() => {
  if (!rosterWidgetId.value) return false
  const summary = post.value?.attendanceSummaryByWidget?.[rosterWidgetId.value]
  return Boolean(summary?.isJoined)
})

const isAuthor = computed(() => post.value?.authorId === userStore.openId)
const postMeta = computed(() => ({
  postId: String(post.value?._id || currentPostId.value || ''),
  postTitle: String(post.value?.content?.[regularWidgets.value[0]?.widgetId] || detailSectionTitle.value || '帖子'),
  sectionId: String(post.value?.sectionId || section.value?._id || ''),
  communityId: String(post.value?.communityId || section.value?.communityId || ''),
}))
const detailSectionTitle = computed(() => section.value?.name || '')
const regularWidgets = computed(() =>
  (section.value?.widgets || []).filter((widget: any) => !['attendance', 'admin_notice'].includes(widget.type))
)
const attendanceWidgets = computed(() => (section.value?.widgets || []).filter((widget: any) => widget.type === 'attendance'))

onLoad(async (options: any) => {
  const postId = String(options?.postId || '')
  if (!postId) return
  currentPostId.value = postId
  // 未登录：LoginGuard 已挡住渲染，不发起请求
  if (!userStore.isLoggedIn) return
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
  } catch (error: any) {
    if (error?.message?.includes('需要先加入社区后查看内容')) {
      communityStore.clearCommunityState()
      uni.showToast({ title: '需要先加入社区后查看内容', icon: 'none' })
      uni.reLaunch({ url: '/pages/onboarding/index' })
      return
    }
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
    occupiedSeats: 0,
    isFull: false,
    isJoined: false,
    previewUsers: [],
  }
}

function attendanceCardClass(widget: any) {
  const s = getAttendanceSummary(widget)
  return {
    'is-joined': s.isJoined,
    'is-full': s.isFull && !s.isJoined,
  }
}

function attendanceTagClass(widget: any) {
  const s = getAttendanceSummary(widget)
  if (s.isJoined) return 'is-joined'
  if (s.isFull) return 'is-full'
  return 'is-join'
}

function attendanceTagText(widget: any) {
  const s = getAttendanceSummary(widget)
  if (s.isJoined) return '已参与'
  if (s.isFull) return '已满座'
  return '去报名'
}

function emptySlotCount(widget: any) {
  const s = getAttendanceSummary(widget)
  const cap = Number(s.capacity || 0)
  if (!cap) return 0
  const filled = Array.isArray(s.previewUsers) ? s.previewUsers.length : 0
  const remainingSeats = Math.max(0, cap - (s.occupiedSeats || 0))
  const remainingVisible = Math.max(0, ATTENDANCE_SLOT_DISPLAY_MAX - filled)
  return Math.min(remainingSeats, remainingVisible)
}

// 按 widgetId 锁：同一 widget 的并发点击被抑制，不同 widget 并发允许
const attendanceLock = useKeyedBusyLock(
  async (widget: any, seatCount: number) => {
    try {
      await postApi.joinAttendance(post.value._id, widget.widgetId, seatCount)
      await loadPost(currentPostId.value)
    } catch (error: any) {
      uni.showToast({ title: error?.message || '报名失败', icon: 'none' })
    }
  },
  (widget: any) => String(widget.widgetId),
)

async function handleAttendanceAction(widget: any) {
  if (!post.value) return
  const summary = getAttendanceSummary(widget)

  // 已参与 → 直接打开名单（取消动作在 sheet 里）
  if (summary.isJoined) {
    await openRoster(widget)
    return
  }
  // 已满座且未参与 → 只能看名单
  if (summary.isFull) {
    uni.showToast({ title: '已满座，可查看名单', icon: 'none' })
    await openRoster(widget)
    return
  }

  // 未参与 → 选人数后报名
  const capacity = Number(summary.capacity || 0)
  const occupied = Number(summary.occupiedSeats || 0)
  const remaining = capacity ? Math.max(1, capacity - occupied) : 6
  const maxChoices = Math.min(remaining, 6) // uni.showActionSheet 微信上限 6 项
  const itemList = Array.from({ length: maxChoices }, (_, i) => {
    const n = i + 1
    return n === 1 ? '仅我 1 人' : `我 + ${n - 1} 人（共 ${n} 座）`
  })

  try {
    const res: any = await new Promise((resolve, reject) => {
      uni.showActionSheet({
        itemList,
        success: (r) => resolve(r),
        fail: (e) => reject(e),
      })
    })
    const seatCount = Number(res?.tapIndex ?? -1) + 1
    if (seatCount < 1) return
    await attendanceLock.run(widget, seatCount)
  } catch (_) {
    // 用户取消 ActionSheet，不提示
  }
}

async function openRoster(widget: any) {
  if (!post.value) return
  try {
    const res = await postApi.listAttendanceMembers(post.value._id, widget.widgetId)
    rosterMembers.value = res.members || []
    rosterTitle.value = resolveAttendanceWidgetLabel(widget) || '参与名单'
    rosterWidgetId.value = widget.widgetId
    rosterMeta.total = Number(res.total || 0)
    rosterMeta.occupiedSeats = Number(res.occupiedSeats || 0)
    rosterMeta.capacity = res.capacity
    showRoster.value = true
  } catch (error: any) {
    uni.showToast({ title: error?.message || '加载名单失败', icon: 'none' })
  }
}

async function handleCancelInSheet() {
  if (!post.value || !rosterWidgetId.value || cancelBusy.value) return
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '取消参与',
      content: '确定要取消这次报名吗？',
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return
  cancelBusy.value = true
  try {
    await postApi.leaveAttendance(post.value._id, rosterWidgetId.value)
    await loadPost(currentPostId.value)
    // 刷新 sheet 内容，保持打开状态
    const widget = attendanceWidgets.value.find((w: any) => w.widgetId === rosterWidgetId.value)
    if (widget) {
      const res = await postApi.listAttendanceMembers(post.value._id, widget.widgetId)
      rosterMembers.value = res.members || []
      rosterMeta.total = Number(res.total || 0)
      rosterMeta.occupiedSeats = Number(res.occupiedSeats || 0)
      rosterMeta.capacity = res.capacity
    }
    uni.showToast({ title: '已取消参与', icon: 'success' })
  } catch (error: any) {
    uni.showToast({ title: error?.message || '取消失败', icon: 'none' })
  } finally {
    cancelBusy.value = false
  }
}

function closeRoster() {
  showRoster.value = false
  rosterWidgetId.value = ''
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

async function uploadNoteBlockImages(blocks: any[]): Promise<any[]> {
  return Promise.all((blocks || []).map(async (block) => {
    if (!block || block.type !== 'image') return block
    const [fileID] = await uploadImages([String(block.fileID || '')])
    return { ...block, fileID }
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
      if (widget.type === 'note_blocks' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadNoteBlockImages(content[widget.widgetId])
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

/* Classical Dossier · 参与条 */
.attendance-card {
  position: relative;
  margin-top: $hh-space-lg;
  padding: $hh-space-lg $hh-space-lg $hh-space-md;
  border: 1rpx solid $hh-ink-line;
  border-radius: $hh-radius-lg;
  background: $hh-surface-1;
}

.attendance-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $hh-space-md;
}

.attendance-title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 0;
  font-family: $hh-font-serif;
  font-size: 34rpx;
  color: $hh-ink-1;
  letter-spacing: $hh-tracking-serif-sm;
}

.attendance-count {
  font-family: $hh-font-num;
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
}

.attendance-sep {
  color: $hh-ink-3;
  margin: 0 4rpx;
}

.attendance-label {
  font-weight: $hh-font-weight-bold;
  color: $hh-ink-1;
}

.attendance-tag {
  flex-shrink: 0;
  font-family: $hh-font-sans;
  font-size: 24rpx;
  font-weight: $hh-font-weight-medium;
  padding: 10rpx 18rpx;
  border-radius: $hh-radius-sm;
  letter-spacing: 0.04em;

  &.is-join {
    background: $hh-accent;
    color: #fff;
    border: 1rpx solid $hh-accent;
  }
  &.is-joined {
    background: $hh-surface-1;
    color: $hh-accent-ink;
    border: 1rpx solid $hh-accent-line;
  }
  &.is-full {
    background: $hh-surface-2;
    color: $hh-ink-3;
    border: 1rpx solid $hh-ink-line;
  }
}

/* 头像堆叠 */
.hh-avatar-stack {
  margin-top: $hh-space-md;
  display: flex;
  align-items: center;
  min-height: 68rpx;
  padding-left: 6rpx;
}

.hh-avatar-slot {
  position: relative;
  width: 64rpx;
  height: 64rpx;
  margin-left: -12rpx;
  border-radius: 50%;
  background: $hh-surface-2;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;

  &:first-child {
    margin-left: 0;
  }

  &.is-self {
    box-shadow: 0 0 0 3rpx $hh-accent, 0 0 0 5rpx $hh-surface-1;
    z-index: 2;
  }
}

.hh-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2rpx solid $hh-surface-1;
  background: $hh-surface-2;
}

.hh-avatar-slot--empty {
  border: 2rpx dashed $hh-ink-line;
  background: transparent;
}

.hh-avatar-empty-mark {
  font-size: 28rpx;
  color: $hh-ink-3;
  line-height: 1;
}

.hh-avatar-empty-text {
  font-size: 24rpx;
  color: $hh-ink-3;
  padding-left: $hh-space-xs;
}

.hh-avatar-badge {
  position: absolute;
  top: -4rpx;
  right: -4rpx;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 6rpx;
  border-radius: 14rpx;
  background: $hh-accent;
  color: #fff;
  font-family: $hh-font-num;
  font-size: 20rpx;
  font-weight: $hh-font-weight-bold;
  line-height: 28rpx;
  text-align: center;
  border: 2rpx solid $hh-surface-1;
  box-sizing: content-box;
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

.roster-actions {
  display: flex;
  align-items: center;
  gap: $hh-space-md;
}

.roster-cancel {
  font-size: $hh-font-caption;
  color: $hh-color-danger;
  padding: $hh-space-xs $hh-space-sm;

  &.disabled {
    color: $hh-ink-3;
    pointer-events: none;
  }
}

.roster-close {
  font-size: $hh-font-caption;
  color: $hh-ink-3;
  padding: $hh-space-xs $hh-space-sm;
}

.roster-companion {
  font-size: $hh-font-caption;
  color: $hh-accent-ink;
  margin-left: 8rpx;
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
