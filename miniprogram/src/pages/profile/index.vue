<template>
  <view class="profile-page">
    <!-- User info / login form -->
    <view class="user-card">
      <!-- 已登录且非编辑态：显示头像+昵称+登出/编辑按钮 -->
      <template v-if="userStore.isLoggedIn && !isEditingProfile">
        <image :src="userStore.avatarUrl || '/static/default-avatar.png'" class="avatar" />
        <view class="user-info">
          <text class="name">{{ userStore.nickName || '未登录' }}</text>
          <view class="action-row">
            <button size="mini" @tap="openEditProfile">编辑资料</button>
            <button size="mini" @tap="handleLogout">登出</button>
          </view>
        </view>
      </template>

      <!-- 编辑态：头像 + 昵称表单（chooseAvatar 明显可见） -->
      <template v-else-if="isEditingProfile">
        <view class="login-form">
          <text class="form-title">编辑资料</text>
          <text class="form-hint">修改头像和昵称后点击保存</text>

          <!-- 头像按钮：微信原生 chooseAvatar，右下角相机徽标提示可点 -->
          <view class="avatar-row">
            <button
              v-if="supportsChooseAvatar"
              open-type="chooseAvatar"
              class="avatar-picker-btn"
              @chooseavatar="onChooseAvatar"
            >
              <view class="avatar-edit-wrap">
                <image
                  :src="formAvatarDisplay || '/static/default-avatar.png'"
                  class="avatar-preview"
                />
                <view class="avatar-edit-badge">📷</view>
              </view>
            </button>
            <image
              v-else
              :src="formAvatarDisplay || '/static/default-avatar.png'"
              class="avatar-preview"
            />
            <text class="avatar-hint">
              {{ supportsChooseAvatar ? '点击更换头像' : '当前基础库暂不支持修改头像' }}
            </text>
          </view>

          <!-- 昵称输入：进入编辑态自动 focus，键盘弹起即显示微信昵称候选 -->
          <view class="input-wrap">
            <input
              type="nickname"
              :focus="true"
              :value="formNickName"
              placeholder="请输入昵称"
              placeholder-class="input-placeholder"
              maxlength="20"
              class="input"
              @input="onNickInput"
              @blur="onNickBlur"
            />
          </view>

          <view class="form-actions">
            <button size="mini" @tap="cancelEditProfile">取消</button>
            <button
              size="mini"
              :disabled="!canSubmitForm || submitFormLock.busy.value"
              class="primary-btn"
              @tap="submitFormLock.run()"
            >
              {{ submitFormLock.busy.value ? '保存中...' : '保存' }}
            </button>
          </view>
        </view>
      </template>

      <!-- 未登录态：支持 chooseAvatar 时走"一按钮登录"，否则 fallback 旧表单 -->
      <template v-else-if="supportsChooseAvatar">
        <view class="login-form">
          <text class="form-title">登录</text>
          <text class="form-hint">点击下方按钮，选择你的头像和昵称</text>

          <button
            open-type="chooseAvatar"
            class="login-hero-btn"
            @chooseavatar="onLoginChooseAvatar"
          >微信登录</button>

          <view class="login-alt-row">
            <text class="login-alt-hint">使用其他账号？</text>
            <text class="login-alt-link" @tap="showDevLogin = true">DEV 登录</text>
          </view>
        </view>
      </template>

      <!-- Fallback：H5 / 老基础库，旧三步表单 -->
      <template v-else>
        <view class="login-form">
          <text class="form-title">登录</text>
          <text class="form-hint">当前环境不支持微信原生登录，请手动填写</text>

          <view class="avatar-row">
            <image
              :src="formAvatarDisplay || '/static/default-avatar.png'"
              class="avatar-preview"
            />
            <text class="avatar-hint">默认头像</text>
          </view>

          <view class="input-wrap">
            <input
              type="nickname"
              :value="formNickName"
              placeholder="请输入昵称"
              placeholder-class="input-placeholder"
              maxlength="20"
              class="input"
              @input="onNickInput"
              @blur="onNickBlur"
            />
          </view>

          <view class="form-actions">
            <button
              size="mini"
              :disabled="!canSubmitForm || submitFormLock.busy.value"
              class="primary-btn"
              @tap="submitFormLock.run()"
            >
              {{ submitFormLock.busy.value ? '登录中...' : '确认登录' }}
            </button>
            <button
              size="mini"
              class="dev-btn"
              @tap="showDevLogin = true"
            >DEV 登录</button>
          </view>
        </view>
      </template>
    </view>

    <!-- 昵称确认浮层：chooseAvatar 回调后自动弹出 -->
    <view v-if="showNickConfirm" class="nick-modal-mask" @tap="cancelNickConfirm">
      <view class="nick-modal" @tap.stop>
        <image
          :src="formAvatarDisplay || '/static/default-avatar.png'"
          class="nick-modal-avatar"
        />
        <text class="nick-modal-title">请确认你的昵称</text>
        <text class="nick-modal-hint">点击下方输入框可使用微信昵称</text>
        <view class="input-wrap">
          <input
            type="nickname"
            :focus="true"
            :value="formNickName"
            placeholder="请输入昵称"
            placeholder-class="input-placeholder"
            maxlength="20"
            class="input"
            @input="onNickInput"
            @blur="onNickBlur"
          />
        </view>
        <view class="nick-modal-actions">
          <button size="mini" @tap="cancelNickConfirm">取消</button>
          <button
            size="mini"
            :disabled="!canSubmitForm || submitFormLock.busy.value"
            class="primary-btn"
            @tap="submitFormLock.run()"
          >
            {{ submitFormLock.busy.value ? '登录中...' : '确认登录' }}
          </button>
        </view>
      </view>
    </view>

    <!-- DEV login modal -->
    <view v-if="showDevLogin" class="dev-modal-mask" @tap="showDevLogin = false">
      <view class="dev-modal" @tap.stop>
        <text class="dev-title">DEV 模式登录</text>
        <text class="dev-desc">绕过微信登录，用指定 openid 登录（测试用，不要在正式环境使用）</text>
        <view class="input-wrap">
          <input v-model="devOpenid" placeholder="openid（留空则自动生成）" placeholder-class="input-placeholder" class="input" />
        </view>
        <view class="input-wrap">
          <input v-model="devNickname" placeholder="昵称" placeholder-class="input-placeholder" class="input" />
        </view>
        <view class="dev-actions">
          <button size="mini" @tap="showDevLogin = false">取消</button>
          <button size="mini" :disabled="devLoginLock.busy.value" @tap="devLoginLock.run()" class="dev-login-btn">
            {{ devLoginLock.busy.value ? '登录中...' : '登录' }}
          </button>
        </view>
      </view>
    </view>

    <!-- My Communities -->
    <view class="section">
      <text class="section-title">我的社区</text>
      <view
        v-for="c in communityStore.myCommunities"
        :key="c._id"
        class="list-item"
        @tap="communityStore.switchCommunity(c._id)"
      >
        <text class="item-name">{{ c.name }}</text>
        <view class="community-actions" @tap.stop>
          <view class="badges">
            <text v-if="isAdminOf(c._id)" class="badge admin">管理员</text>
            <text v-if="c._id === communityStore.currentCommunityId" class="badge current">当前</text>
          </view>
          <button
            v-if="canLeaveCommunity(c)"
            size="mini"
            class="leave-community-btn"
            :disabled="leaveCommunityLock.isBusy(c._id)"
            @tap.stop="leaveCommunityLock.run(c)"
          >
            {{ leaveCommunityLock.isBusy(c._id) ? '退出中...' : '退出' }}
          </button>
        </view>
      </view>
      <view v-if="communityStore.myCommunities.length === 0" class="empty">
        <text>还没有加入社区</text>
      </view>
      <button size="mini" class="join-btn" @tap="goOnboarding">
        加入或创建社区
      </button>
    </view>

    <view data-testid="profile-feedback-contact-card" class="feedback-contact-card">
      <view class="feedback-copy">
        <text class="feedback-title">联系与反馈</text>
        <text class="feedback-desc">使用中遇到问题，或有建议想告诉我，可以直接留言。</text>
      </view>
      <button
        class="feedback-contact-btn"
        open-type="contact"
        show-message-card
        send-message-title="HappyHome 使用反馈"
        send-message-path="/pages/profile/index"
      >
        留言反馈
      </button>
    </view>

    <!-- Admin notification subscription -->
    <view v-if="hasAdminTools" class="section">
      <text class="section-title">管理员提醒</text>
      <text class="hint-text">开启后，有新的社区创建申请或成员加入申请时，微信会尽量发送服务通知。</text>
      <button
        size="mini"
        class="notify-btn"
        :disabled="notificationSubscribeLock.busy.value || configuredNotificationTemplates.length === 0"
        @tap="notificationSubscribeLock.run()"
      >
        {{ notificationSubscribeLock.busy.value ? '开启中...' : '接收审批提醒' }}
      </button>
      <text v-if="configuredNotificationTemplates.length === 0" class="hint-text warn">
        订阅消息模板尚未配置，暂时只能在后台查看待办。
      </text>
      <view v-else class="notification-status">
        <text v-for="item in configuredNotificationTemplates" :key="item.eventType" class="status-pill">
          {{ item.label }}：{{ subscriptionStatusLabel(item.eventType, item.templateId) }}
        </text>
      </view>
    </view>

    <!-- Pending approvals (admin only) -->
    <view v-if="pendingMembers.length > 0" class="section">
      <text class="section-title">待审批成员</text>
      <view v-for="member in pendingMembers" :key="member._id" class="approval-item">
        <text class="member-id">{{ member.userId.slice(0, 8) }}...</text>
        <view class="approval-actions">
          <button
            size="mini"
            :disabled="approveLock.isBusy(member._id) || rejectLock.isBusy(member._id)"
            @tap="approveLock.run(member)"
            class="approve-btn"
          >通过</button>
          <button
            size="mini"
            :disabled="approveLock.isBusy(member._id) || rejectLock.isBusy(member._id)"
            @tap="rejectLock.run(member)"
          >拒绝</button>
        </view>
      </view>
    </view>
    <view class="profile-version">
      <text>ver: {{ appVersion }}</text>
    </view>
    <AppTabBar current="profile" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi, notificationApi, type ApprovalNotificationEventType } from '../../api/cloud'
import AppTabBar from '../../components/AppTabBar.vue'
import { hideNativeTabBar } from '../../utils/app-tabbar'
import { useBusyLock, useKeyedBusyLock } from '../../utils/useBusyLock'
import { BUILD_INFO } from '../../generated/build-info'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const pendingMembers = ref<any[]>([])
const adminCommunityIds = ref<string[]>([])
const notificationSubscriptions = ref<Array<{ eventType: ApprovalNotificationEventType; templateId: string; status: string }>>([])
let refreshingProfile = false
const appVersion = computed(() => {
  const rawVersion = String(BUILD_INFO.version || BUILD_INFO.buildId || 'unknown')
  return rawVersion.replace(/^1\.0\./, '0.7.')
})

const notificationTemplates = [
  {
    eventType: 'member_join_pending' as ApprovalNotificationEventType,
    label: '成员加入申请',
    templateId: String((import.meta as any).env?.VITE_APPROVAL_MEMBER_JOIN_TEMPLATE_ID || ''),
  },
  {
    eventType: 'community_create_pending' as ApprovalNotificationEventType,
    label: '社区创建申请',
    templateId: String((import.meta as any).env?.VITE_APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID || ''),
  },
]
const configuredNotificationTemplates = computed(() => notificationTemplates.filter(item => item.templateId))
const hasAdminTools = computed(() => userStore.role === 'superAdmin' || adminCommunityIds.value.length > 0)

// ── 登录 / 编辑资料表单状态 ──
const isEditingProfile = ref(false)
const showNickConfirm = ref(false)    // 登录流程：chooseAvatar 后弹出昵称确认浮层
const formNickName = ref('')
const formAvatarCloudUrl = ref('')    // 已上传到 COS 的 cloud://… URL（持久）
const formAvatarTempPath = ref('')    // chooseAvatar 回传的临时路径（本次提交时上传 COS）

// 同时显示临时路径（用户刚选完、还没点提交）或已确认的 cloud URL
const formAvatarDisplay = computed(() => formAvatarTempPath.value || formAvatarCloudUrl.value)

// 是否支持 <button open-type="chooseAvatar">：需要基础库 ≥ 2.21.2，mp-weixin 环境
const supportsChooseAvatar = computed(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof wx === 'undefined' || !wx?.canIUse) return false
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return !!wx.canIUse('button.open-type.chooseAvatar')
  } catch {
    return false
  }
})

// 表单是否可提交：至少要有昵称
const canSubmitForm = computed(() => formNickName.value.trim().length > 0)

function onChooseAvatar(e: any) {
  const tempPath = e?.detail?.avatarUrl || ''
  if (tempPath) {
    formAvatarTempPath.value = tempPath
  }
}

// 登录态点"微信登录"大按钮 → 微信弹 chooseAvatar → 回调后自动弹昵称确认浮层。
// 和编辑态的 onChooseAvatar 区分：编辑态只换头像，不弹浮层。
function onLoginChooseAvatar(e: any) {
  const tempPath = e?.detail?.avatarUrl || ''
  if (!tempPath) return
  formAvatarTempPath.value = tempPath
  formNickName.value = ''
  showNickConfirm.value = true
}

function cancelNickConfirm() {
  showNickConfirm.value = false
  formAvatarTempPath.value = ''
  formNickName.value = ''
}

function onNickInput(e: any) {
  formNickName.value = String(e?.detail?.value || '')
}
function onNickBlur(e: any) {
  // type="nickname" 的 blur 触发时，系统已经把候选昵称写入 value
  formNickName.value = String(e?.detail?.value || '').trim()
}

/**
 * 上传临时头像到 COS。失败时返回空串（调用方用默认灰头像兜底）。
 */
async function uploadAvatarIfAny(): Promise<string> {
  if (!formAvatarTempPath.value) return formAvatarCloudUrl.value || ''
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof wx === 'undefined' || !wx.cloud?.uploadFile) return ''
    const ext = formAvatarTempPath.value.split('.').pop()?.split('?')[0] || 'jpg'
    const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const res: any = await new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      wx.cloud.uploadFile({
        cloudPath,
        filePath: formAvatarTempPath.value,
        success: resolve,
        fail: reject,
      })
    })
    return String(res?.fileID || '')
  } catch (err) {
    console.warn('[profile] 头像上传失败，使用默认头像兜底', err)
    return ''
  }
}

function openEditProfile() {
  isEditingProfile.value = true
  formNickName.value = userStore.nickName || ''
  formAvatarCloudUrl.value = userStore.avatarUrl || ''
  formAvatarTempPath.value = ''
}

function cancelEditProfile() {
  isEditingProfile.value = false
  formNickName.value = ''
  formAvatarCloudUrl.value = ''
  formAvatarTempPath.value = ''
}

const submitFormLock = useBusyLock(async () => {
  try {
    const avatarUrl = await uploadAvatarIfAny()
    await userStore.login({ nickName: formNickName.value, avatarUrl })
    if (!isEditingProfile.value) {
      // 首次登录：加载我的社区
      await communityStore.loadMyCommunities()
    }
    isEditingProfile.value = false
    showNickConfirm.value = false
    formAvatarTempPath.value = ''
    formAvatarCloudUrl.value = ''
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e: any) {
    uni.showModal({
      title: isEditingProfile.value ? '保存失败' : '登录失败',
      content: e?.message || '请重试',
      showCancel: false,
    })
  }
})

// DEV login modal state
const showDevLogin = ref(false)
const devOpenid = ref('')
const devNickname = ref('')
const devLoginLock = useBusyLock(async () => {
  try {
    await userStore.devLogin(devOpenid.value, devNickname.value)
    await communityStore.loadMyCommunities()
    showDevLogin.value = false
    devOpenid.value = ''
    devNickname.value = ''
    uni.showToast({ title: '登录成功', icon: 'success' })
  } catch (e: any) {
    uni.showModal({ title: '登录失败', content: e?.message || '请检查 openid 格式', showCancel: false })
  }
})

function handleLogout() {
  userStore.logout()
  communityStore.$patch({ myCommunities: [], currentCommunityId: '', currentSections: [] })
  uni.showToast({ title: '已登出', icon: 'none' })
}

function goOnboarding() {
  uni.setStorageSync('onboarding_entry_mode', 'discover')
  uni.reLaunch({ url: '/pages/onboarding/index?mode=discover' })
}

function isAdminOf(communityId: string) {
  return adminCommunityIds.value.includes(communityId)
}

function canLeaveCommunity(community: any) {
  return String(community?.creatorId || '') !== String(userStore.openId || '')
}

const leaveCommunityLock = useKeyedBusyLock(
  async (community: any) => {
    const communityId = String(community?._id || '')
    if (!communityId) return
    if (!canLeaveCommunity(community)) {
      uni.showToast({ title: '创建者不能退出社区', icon: 'none' })
      return
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '退出社区',
        content: '退出后将无法查看该社区内容，需要重新加入后才能访问。',
        confirmText: '退出',
        confirmColor: '#d93026',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return

    try {
      await memberApi.leave(communityId)
      uni.showToast({ title: '已退出社区', icon: 'success' })
      await communityStore.loadMyCommunities()
      if (communityStore.myCommunities.length === 0) {
        uni.reLaunch({ url: '/pages/onboarding/index' })
      }
    } catch (e: any) {
      uni.showToast({ title: e?.message || '退出失败', icon: 'none' })
    }
  },
  (community) => String(community?._id || ''),
)

// Per-member locks: approving different members can happen in parallel.
const approveLock = useKeyedBusyLock(
  async (member: any) => {
    try {
      await memberApi.memberApprove(member.communityId, member._id)
      pendingMembers.value = pendingMembers.value.filter((m) => m._id !== member._id)
      uni.showToast({ title: '已通过', icon: 'success' })
    } catch (e: any) {
      uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
    }
  },
  (member) => member._id,
)
const rejectLock = useKeyedBusyLock(
  async (member: any) => {
    try {
      await memberApi.memberReject(member.communityId, member._id)
      pendingMembers.value = pendingMembers.value.filter((m) => m._id !== member._id)
      uni.showToast({ title: '已拒绝', icon: 'none' })
    } catch (e: any) {
      uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
    }
  },
  (member) => member._id,
)

const notificationSubscribeLock = useBusyLock(async () => {
  const templates = configuredNotificationTemplates.value
  if (templates.length === 0) {
    uni.showToast({ title: '订阅模板尚未配置', icon: 'none' })
    return
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof wx === 'undefined' || typeof wx.requestSubscribeMessage !== 'function') {
    uni.showToast({ title: '请在微信小程序中开启提醒', icon: 'none' })
    return
  }

  const result: Record<string, string> = await new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    wx.requestSubscribeMessage({
      tmplIds: templates.map(item => item.templateId),
      success: resolve,
      fail: reject,
    })
  })

  for (const item of templates) {
    const rawStatus = result[item.templateId] === 'accept' ? 'accept' : 'reject'
    await notificationApi.saveSubscription({
      eventType: item.eventType,
      templateId: item.templateId,
      status: rawStatus,
    })
  }
  await loadNotificationSubscriptions()
  uni.showToast({ title: '提醒设置已保存', icon: 'success' })
})

async function loadPendingMembers() {
  if (!userStore.isLoggedIn) return
  // Reset so repeated calls (onMounted + onShow) don't duplicate entries
  pendingMembers.value = []
  adminCommunityIds.value = []
  // Load pending members for each admin community
  for (const c of communityStore.myCommunities) {
    try {
      const res = await memberApi.pendingList(c._id)
      // pendingList succeeds = user is admin of this community
      adminCommunityIds.value.push(c._id)
      if (res.members.length > 0) {
        pendingMembers.value.push(...res.members.map((m: any) => ({ ...m, communityId: c._id })))
      }
    } catch {
      // Not admin of this community, skip
    }
  }
}

async function loadNotificationSubscriptions() {
  if (!userStore.isLoggedIn) return
  try {
    const res = await notificationApi.mySubscriptions()
    notificationSubscriptions.value = Array.isArray(res.subscriptions) ? res.subscriptions : []
  } catch {
    notificationSubscriptions.value = []
  }
}

function subscriptionStatusLabel(eventType: ApprovalNotificationEventType, templateId: string) {
  const item = notificationSubscriptions.value.find((sub) => sub.eventType === eventType && sub.templateId === templateId)
  if (!item) return '未开启'
  if (item.status === 'accept') return '已开启'
  return '未授权'
}

async function refreshProfileData() {
  if (refreshingProfile || !userStore.isLoggedIn) return
  refreshingProfile = true
  try {
    await communityStore.loadMyCommunities()
    await loadPendingMembers()
    if (hasAdminTools.value) await loadNotificationSubscriptions()
  } finally {
    refreshingProfile = false
  }
}

onMounted(() => {
  hideNativeTabBar()
  void refreshProfileData()
})
// tabBar 切回 Profile 只触发 onShow，不会重新 mount。新申请者 / 被审批后的状态
// 需要在 onShow 重新拉取，否则 admin 在本 tab 看不到实时变动。
onShow(() => {
  hideNativeTabBar()
  void refreshProfileData()
})
</script>

<style lang="scss" scoped>
.profile-page { padding: $hh-space-lg $hh-space-lg calc(132rpx + env(safe-area-inset-bottom)); background: $hh-color-bg-sub; min-height: 100vh; }
.user-card { background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-lg; display: flex; align-items: center; margin-bottom: $hh-space-md; }
.avatar { width: 100rpx; height: 100rpx; border-radius: $hh-radius-full; margin-right: $hh-space-md; }
.name { font-size: $hh-font-h3; font-weight: $hh-font-weight-bold; color: $hh-color-text; display: block; }
.user-info { flex: 1; min-width: 0; }
.action-row { display: flex; gap: $hh-space-sm; margin-top: $hh-space-xs; }

.feedback-contact-card {
  background: $hh-color-surface;
  border: 1rpx solid $hh-color-border;
  border-radius: $hh-radius-md;
  padding: $hh-space-md $hh-space-lg;
  margin-bottom: $hh-space-md;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $hh-space-md;
  box-shadow: 0 8rpx 20rpx rgba(58, 106, 69, 0.06);
}
.feedback-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.feedback-title {
  font-size: $hh-font-body-lg;
  font-weight: $hh-font-weight-bold;
  color: $hh-color-text;
}
.feedback-desc {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  line-height: 1.5;
}
.feedback-contact-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 26rpx;
  height: 60rpx;
  line-height: 60rpx;
  border-radius: $hh-radius-full;
  background: $hh-color-primary;
  color: $hh-color-surface;
  font-size: $hh-font-caption;
  font-weight: $hh-font-weight-bold;
}
.feedback-contact-btn::after { border: none; }

/* ── 登录 / 编辑资料表单 ── */
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: $hh-space-md;
}
.form-title {
  font-size: $hh-font-h3;
  font-weight: $hh-font-weight-bold;
  color: $hh-color-text;
  display: block;
}
.form-hint {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  display: block;
  line-height: 1.5;
}
.avatar-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $hh-space-xs;
  padding: $hh-space-md 0;
}
.avatar-picker-btn {
  padding: 0;
  background: transparent;
  border: none;
  line-height: 1;
}
.avatar-picker-btn::after { border: none; }
.avatar-edit-wrap {
  position: relative;
  width: 140rpx;
  height: 140rpx;
}
.avatar-preview {
  width: 140rpx;
  height: 140rpx;
  border-radius: $hh-radius-full;
  background: $hh-color-bg-sub;
}
.avatar-edit-badge {
  position: absolute;
  right: -4rpx;
  bottom: -4rpx;
  width: 44rpx;
  height: 44rpx;
  border-radius: $hh-radius-full;
  background: $hh-accent;
  color: #fff;
  font-size: 24rpx;
  line-height: 44rpx;
  text-align: center;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.15);
}
.avatar-hint {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}

/* ── 登录 Hero 按钮 + DEV 小字链接 ── */
.login-hero-btn {
  width: 78%;
  height: 76rpx;
  align-self: center;
  background: $hh-surface-1;
  color: $hh-accent-ink;
  border: 2rpx solid $hh-accent-line;
  box-shadow: 0 8rpx 20rpx rgba(58, 106, 69, 0.08);
  font-size: $hh-font-body;
  font-weight: $hh-font-weight-bold;
  line-height: 76rpx;
  padding: 0;
  border-radius: $hh-radius-full;
  margin-top: $hh-space-xs;
}
.login-hero-btn::after { border: none; }
.login-hero-btn[disabled] { opacity: $hh-opacity-disabled; }
.login-alt-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: $hh-space-xs;
  margin-top: $hh-space-sm;
}
.login-alt-hint {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
}
.login-alt-link {
  font-size: $hh-font-caption;
  color: $hh-accent;
  text-decoration: underline;
}
.form-actions {
  display: flex;
  gap: $hh-space-sm;
  flex-wrap: wrap;
  margin-top: $hh-space-xs;
}
.form-actions button { flex: 1; min-width: 160rpx; }
.primary-btn { background: $hh-color-primary; color: $hh-color-text-inverse; }
.primary-btn[disabled] { opacity: $hh-opacity-disabled; }
.section { background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-md $hh-space-lg; margin-bottom: $hh-space-md; }
.section-title { font-size: $hh-font-body; color: $hh-color-text-mute; display: block; margin-bottom: $hh-space-md; }
.list-item { display: flex; justify-content: space-between; align-items: center; padding: $hh-space-md 0; border-bottom: 1rpx solid $hh-color-divider; }
.item-name { font-size: $hh-font-body-lg; color: $hh-color-text; }
.community-actions { display: flex; align-items: center; gap: $hh-space-sm; }
.badges { display: flex; gap: $hh-space-xs; }
.badge { font-size: $hh-font-tag; padding: 4rpx 12rpx; border-radius: $hh-radius-lg; }
.badge.admin { background: #e3f2fd; color: #1565c0; }
.badge.current { background: #e8f5e9; color: #2e7d32; }
.leave-community-btn {
  margin: 0;
  padding: 0 18rpx;
  line-height: 48rpx;
  font-size: $hh-font-caption;
  color: #d93026;
  background: #fff5f5;
  border: 1rpx solid #ffd6d6;
}
.leave-community-btn::after { border: none; }
.empty { color: $hh-color-text-mute; font-size: $hh-font-body; padding: $hh-space-md 0; }
.join-btn { margin-top: $hh-space-md; }
.approval-item { display: flex; justify-content: space-between; align-items: center; padding: $hh-space-md 0; border-bottom: 1rpx solid $hh-color-divider; }
.member-id { font-size: $hh-font-caption; color: $hh-color-text-sub; font-family: monospace; }
.approval-actions { display: flex; gap: $hh-space-sm; }
.hint-text { display: block; margin-top: $hh-space-sm; color: $hh-color-text-sub; font-size: $hh-font-caption; line-height: $hh-line-height-base; }
.hint-text.warn { color: #b7791f; }
.notify-btn { margin-top: $hh-space-md; background: $hh-color-primary; color: $hh-color-text-inverse; }
.notification-status { display: flex; flex-wrap: wrap; gap: $hh-space-sm; margin-top: $hh-space-md; }
.status-pill { padding: 6rpx 14rpx; border-radius: $hh-radius-full; background: #f3f6f4; color: $hh-color-text-sub; font-size: $hh-font-caption; }
.profile-version {
  padding: 20rpx 0 10rpx;
  text-align: center;
  font-family: $hh-font-mono;
  font-size: 18rpx;
  color: $hh-color-text-mute;
  opacity: 0.58;
}
.profile-version text {
  user-select: text;
}

.login-actions { display: flex; gap: $hh-space-sm; }
.dev-btn { background: $hh-color-warning; color: $hh-color-text-inverse; font-size: $hh-font-caption; }

.dev-modal-mask {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  background: $hh-color-mask;
  display: flex; align-items: center; justify-content: center;
  z-index: $hh-z-modal;
}
.dev-modal {
  background: $hh-color-surface; border-radius: $hh-radius-md;
  padding: 40rpx $hh-space-lg; width: 84%; max-width: 600rpx;
  display: flex; flex-direction: column; gap: $hh-space-md;
  box-shadow: $hh-shadow-modal;
}
.dev-title { font-size: $hh-font-h3; font-weight: $hh-font-weight-bold; text-align: center; color: $hh-color-text; }
.dev-desc { font-size: $hh-font-caption; color: $hh-color-text-mute; line-height: $hh-line-height-base; }
.dev-actions { display: flex; gap: $hh-space-sm; margin-top: $hh-space-xs; }
.dev-actions button { flex: 1; }

/* ── 昵称确认浮层（登录流程） ── */
.nick-modal-mask {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  background: $hh-color-mask;
  display: flex; align-items: center; justify-content: center;
  z-index: $hh-z-modal;
}
.nick-modal {
  background: $hh-color-surface; border-radius: $hh-radius-md;
  padding: 40rpx $hh-space-lg; width: 84%; max-width: 600rpx;
  display: flex; flex-direction: column; align-items: center;
  gap: $hh-space-md;
  box-shadow: $hh-shadow-modal;
}
.nick-modal-avatar {
  width: 160rpx;
  height: 160rpx;
  border-radius: $hh-radius-full;
  background: $hh-color-bg-sub;
}
.nick-modal-title {
  font-size: $hh-font-h3;
  font-weight: $hh-font-weight-bold;
  color: $hh-color-text;
}
.nick-modal-hint {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  text-align: center;
}
.nick-modal .input-wrap {
  width: 100%;
  box-sizing: border-box;
}
.nick-modal-actions {
  display: flex;
  gap: $hh-space-sm;
  width: 100%;
}
.nick-modal-actions button { flex: 1; }

.input-wrap { background: $hh-color-bg-sub; border-radius: $hh-radius-sm; padding: $hh-space-md; }
.input { font-size: $hh-font-body; width: 100%; min-height: 40rpx; background: transparent; color: $hh-color-text; }
.input-placeholder { color: $hh-color-text-mute; font-size: $hh-font-body; }
.dev-login-btn { background: $hh-color-text; color: $hh-color-text-inverse; }
.approve-btn { background: $hh-color-info; color: $hh-color-text-inverse; }
</style>
