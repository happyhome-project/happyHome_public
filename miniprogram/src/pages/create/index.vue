<template>
  <view class="create-page">
    <view v-if="!userStore.isLoggedIn" class="guard-state">
      <text class="guard-title">请先登录</text>
      <text class="guard-desc">登录后才能发布内容</text>
      <button class="btn-primary-plain" size="mini" @tap="goLogin">去登录</button>
    </view>

    <view v-else-if="!communityStore.currentCommunityId" class="guard-state">
      <text class="guard-title">还没有加入社区</text>
      <text class="guard-desc">加入社区后才能发布</text>
      <button class="btn-primary-plain" size="mini" @tap="goOnboarding">去加入</button>
    </view>

    <view v-else-if="!membershipReady && membershipChecking" class="guard-state">
      <text class="guard-desc">检查社区成员身份中...</text>
    </view>

    <view v-else-if="!isMember" class="guard-state">
      <text class="guard-title">你还不是“{{ communityStore.currentCommunity?.name }}”的成员</text>
      <text class="guard-desc">{{ memberStatus === 'pending' ? '你的加入申请正在审批中，请耐心等待' : '加入社区后才能发布' }}</text>
      <button
        v-if="memberStatus !== 'pending'"
        class="btn-primary-plain"
        size="mini"
        :disabled="joining"
        @tap="handleJoin"
      >
        {{ joining ? '加入中...' : '加入社区' }}
      </button>
    </view>

    <template v-else>
      <view v-if="!selectedSection" class="section-picker">
        <text class="title">选择板块</text>
        <view
          v-for="section in activeSections"
          :key="section._id"
          class="section-option"
          @tap="selectSection(section)"
        >
          <text class="section-name">{{ section.name }}</text>
          <text class="arrow">→</text>
        </view>
        <view v-if="activeSections.length === 0" class="empty-hint">
          <text class="guard-desc">该社区还没有可发布的板块</text>
        </view>
      </view>

      <view v-else class="form">
        <view class="form-header">
          <text class="section-tag" @tap="selectedSection = null">← {{ selectedSection.name }}</text>
        </view>

        <!-- 未配置控件的板块：提示并禁用发布，避免空帖 -->
        <view
          v-if="editableWidgets.length === 0 && attendanceWidgets.length === 0"
          class="empty-widgets-hint"
        >
          <text class="empty-widgets-title">{{ adminNoticeWidgets.length > 0 ? '该板块由管理员维护' : '该板块尚未配置内容模板' }}</text>
          <text class="empty-widgets-desc">
            {{ adminNoticeWidgets.length > 0 ? '这里展示的是固定公告内容，成员无需发布帖子。' : '请联系社区管理员在"控件"里添加需要填写的字段后再来发布。' }}
          </text>
        </view>

        <template v-else>
          <WidgetEditor
            v-for="widget in editableWidgets"
            :key="widget.widgetId"
            :widget="widget"
            v-model="formData[widget.widgetId]"
          />

          <view v-for="widget in attendanceWidgets" :key="widget.widgetId" class="attendance-hint">
            <text class="attendance-label">{{ widget.label }}</text>
            <text class="attendance-desc">发布后成员可点击参与，人数和头像会自动统计。</text>
          </view>

          <button class="btn-primary" :disabled="submitting" @tap="handleSubmit">
            {{ submitting ? '发布中...' : '发布' }}
          </button>
        </template>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi, postApi } from '../../api/cloud'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const selectedSection = ref<any>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)
const membershipChecking = ref(false)
const membershipReady = ref(false)
const isMember = ref(false)
const memberStatus = ref<string | null>(null)
const joining = ref(false)
let checkSeq = 0

// 只允许在 active 板块发帖。dormant / archived 板块既无法发帖也无处展示（首页已过滤）。
const activeSections = computed(() =>
  (communityStore.currentSections ?? []).filter((section: any) => (section?.status ?? 'active') === 'active')
)

const editableWidgets = computed(() =>
  (selectedSection.value?.widgets || []).filter((widget: any) => !['attendance', 'admin_notice'].includes(widget.type))
)

const attendanceWidgets = computed(() =>
  (selectedSection.value?.widgets || []).filter((widget: any) => widget.type === 'attendance')
)

const adminNoticeWidgets = computed(() =>
  (selectedSection.value?.widgets || []).filter((widget: any) => widget.type === 'admin_notice')
)

onLoad(async () => {
  await checkMembership({ silent: false })
})

onShow(() => {
  // 返回页面（例如地图选择返回）时静默刷新，不再打断表单操作。
  void checkMembership({ silent: true })
})

watch(() => communityStore.currentCommunityId, async () => {
  selectedSection.value = null
  membershipReady.value = false
  await checkMembership({ silent: false, forceRefresh: true })
})

async function checkMembership(options: { silent: boolean; forceRefresh?: boolean }) {
  const { silent, forceRefresh = false } = options
  const communityId = String(communityStore.currentCommunityId || '')
  const seq = ++checkSeq

  if (!communityId || !userStore.isLoggedIn) {
    isMember.value = false
    memberStatus.value = null
    membershipReady.value = true
    return
  }

  const cached = communityStore.getMembershipStatus(communityId)
  if (cached && !forceRefresh) {
    isMember.value = cached.isMember
    memberStatus.value = cached.status
    membershipReady.value = true
    if (silent) return
  }

  if (!silent && !membershipReady.value) {
    membershipChecking.value = true
  }

  try {
    await communityStore.refreshMembershipStatus(communityId)
    const latest = communityStore.getMembershipStatus(communityId)
    if (seq !== checkSeq) return
    isMember.value = !!latest?.isMember
    memberStatus.value = latest?.status ?? null
  } catch {
    if (seq !== checkSeq) return
    // 兜底到直接请求，避免 store 未更新时页面卡住。
    try {
      const res = await memberApi.myStatus(communityId)
      isMember.value = !!res.isMember
      memberStatus.value = res.status
    } catch {
      isMember.value = false
      memberStatus.value = null
    }
  } finally {
    if (seq !== checkSeq) return
    membershipReady.value = true
    membershipChecking.value = false
  }
}

async function handleJoin() {
  joining.value = true
  try {
    const res = await memberApi.apply(communityStore.currentCommunityId)
    if ((res as any).status === 'active') {
      isMember.value = true
      memberStatus.value = 'active'
      uni.showToast({ title: '加入成功', icon: 'success' })
    } else {
      memberStatus.value = 'pending'
      uni.showToast({ title: '申请已提交，等待审批', icon: 'none' })
    }
    await checkMembership({ silent: true, forceRefresh: true })
  } catch (error: any) {
    uni.showModal({ title: '加入失败', content: error?.message ?? '请重试' })
  } finally {
    joining.value = false
  }
}

function goLogin() {
  uni.switchTab({ url: '/pages/profile/index' })
}

function goOnboarding() {
  uni.navigateTo({ url: '/pages/onboarding/index?mode=discover' })
}

function selectSection(section: any) {
  selectedSection.value = section
  Object.keys(formData).forEach((key) => delete formData[key])
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

async function handleSubmit() {
  if (!selectedSection.value || submitting.value) return
  submitting.value = true
  try {
    const content = { ...formData }
    for (const widget of editableWidgets.value) {
      if (widget.type === 'image_group' && Array.isArray(content[widget.widgetId])) {
        content[widget.widgetId] = await uploadImages(content[widget.widgetId])
      }
    }

    await postApi.create({
      communityId: communityStore.currentCommunityId,
      sectionId: selectedSection.value._id,
      content,
    })
    uni.showToast({ title: '发布成功', icon: 'success' })
    selectedSection.value = null
    uni.switchTab({ url: '/pages/index/index' })
  } catch (error: any) {
    uni.showModal({ title: '发布失败', content: error?.message ?? '请重试' })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.create-page {
  padding: $hh-space-lg;
  background: $hh-color-bg;
  min-height: 100vh;
}

.title {
  font-size: $hh-font-h2;
  font-weight: $hh-font-weight-medium;
  color: $hh-color-text;
  display: block;
  margin-bottom: $hh-space-lg;
}

.section-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: $hh-space-lg;
  border-radius: $hh-radius-md;
  background: $hh-color-bg-sub;
  margin-bottom: $hh-space-sm;
}

.section-name {
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
}

.arrow {
  font-size: $hh-font-h3;
  color: $hh-color-text-mute;
}

.empty-hint {
  padding: $hh-space-xl 0;
  text-align: center;
}

.form-header {
  margin-bottom: $hh-space-lg;
}

.section-tag {
  font-size: $hh-font-body;
  color: $hh-color-primary-text;
}

.empty-widgets-hint {
  margin-top: $hh-space-xl;
  padding: $hh-space-lg;
  border: 1rpx dashed $hh-color-border;
  border-radius: $hh-radius-md;
  background: $hh-color-bg-sub;
  text-align: center;
}
.empty-widgets-title {
  display: block;
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
  margin-bottom: $hh-space-sm;
  font-weight: $hh-font-weight-medium;
}
.empty-widgets-desc {
  display: block;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  line-height: 1.6;
}

.attendance-hint {
  margin-bottom: $hh-space-lg;
  padding: $hh-space-md;
  border-radius: $hh-radius-md;
  background: #f4f8ff;
}

.attendance-label {
  display: block;
  font-size: $hh-font-body;
  color: $hh-color-text;
  margin-bottom: $hh-space-xs;
}

.attendance-desc {
  display: block;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

.btn-primary {
  margin-top: $hh-space-xl;
  background: $hh-color-primary;
  color: $hh-color-text-inverse;
  border-radius: $hh-radius-md;
  font-size: $hh-font-h3;
  padding: $hh-space-md;
  border: none;
}

.btn-primary[disabled] {
  opacity: $hh-opacity-disabled;
}

.btn-primary-plain {
  margin-top: $hh-space-sm;
  background: $hh-color-bg;
  color: $hh-color-primary;
  border: 2rpx solid $hh-color-primary;
  border-radius: $hh-radius-sm;
  font-size: $hh-font-body;
}

.btn-primary-plain[disabled] {
  opacity: $hh-opacity-disabled;
}

.guard-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: $hh-space-md;
}

.guard-title {
  font-size: $hh-font-h3;
  font-weight: $hh-font-weight-medium;
  color: $hh-color-text;
  text-align: center;
}

.guard-desc {
  font-size: $hh-font-body;
  color: $hh-color-text-mute;
  text-align: center;
}
</style>
