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

      <!-- 未登录 or 编辑态：显示采集表单 -->
      <template v-else>
        <view class="login-form">
          <text class="form-title">
            {{ isEditingProfile ? '编辑资料' : '登录' }}
          </text>
          <text class="form-hint">
            {{ isEditingProfile ? '修改头像和昵称后点击保存' : '点击头像选择、输入昵称后登录' }}
          </text>

          <!-- 头像按钮：微信原生 chooseAvatar，弹出系统选择器 -->
          <view class="avatar-row">
            <button
              v-if="supportsChooseAvatar"
              open-type="chooseAvatar"
              class="avatar-picker-btn"
              @chooseavatar="onChooseAvatar"
            >
              <image
                :src="formAvatarDisplay || '/static/default-avatar.png'"
                class="avatar-preview"
              />
            </button>
            <image
              v-else
              :src="formAvatarDisplay || '/static/default-avatar.png'"
              class="avatar-preview"
            />
            <text class="avatar-hint">
              {{ supportsChooseAvatar ? '点击选择头像' : '当前环境不支持选头像' }}
            </text>
          </view>

          <!-- 昵称输入：type="nickname" 触发微信真实昵称候选 -->
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
              v-if="isEditingProfile"
              size="mini"
              @tap="cancelEditProfile"
            >取消</button>
            <button
              size="mini"
              :disabled="!canSubmitForm || submitFormLock.busy.value"
              class="primary-btn"
              @tap="submitFormLock.run()"
            >
              {{ submitFormLock.busy.value ? (isEditingProfile ? '保存中...' : '登录中...') : (isEditingProfile ? '保存' : '确认登录') }}
            </button>
            <button
              v-if="!isEditingProfile"
              size="mini"
              class="dev-btn"
              @tap="showDevLogin = true"
            >DEV 登录</button>
          </view>
        </view>
      </template>
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
        <view class="badges">
          <text v-if="isAdminOf(c._id)" class="badge admin">管理员</text>
          <text v-if="c._id === communityStore.currentCommunityId" class="badge current">当前</text>
        </view>
      </view>
      <view v-if="communityStore.myCommunities.length === 0" class="empty">
        <text>还没有加入社区</text>
      </view>
      <button size="mini" class="join-btn" @tap="goOnboarding">
        加入或创建社区
      </button>
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
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi } from '../../api/cloud'
import { useBusyLock, useKeyedBusyLock } from '../../utils/useBusyLock'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const pendingMembers = ref<any[]>([])
const adminCommunityIds = ref<string[]>([])

// ── 登录 / 编辑资料表单状态 ──
const isEditingProfile = ref(false)
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
  uni.reLaunch({ url: '/pages/onboarding/index' })
}

function isAdminOf(communityId: string) {
  return adminCommunityIds.value.includes(communityId)
}

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

onMounted(() => { void loadPendingMembers() })
// tabBar 切回 Profile 只触发 onShow，不会重新 mount。新申请者 / 被审批后的状态
// 需要在 onShow 重新拉取，否则 admin 在本 tab 看不到实时变动。
onShow(() => { void loadPendingMembers() })
</script>

<style lang="scss" scoped>
.profile-page { padding: $hh-space-lg; background: $hh-color-bg-sub; min-height: 100vh; }
.user-card { background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-lg; display: flex; align-items: center; margin-bottom: $hh-space-md; }
.avatar { width: 100rpx; height: 100rpx; border-radius: $hh-radius-full; margin-right: $hh-space-md; }
.name { font-size: $hh-font-h3; font-weight: $hh-font-weight-bold; color: $hh-color-text; display: block; }
.user-info { flex: 1; min-width: 0; }
.action-row { display: flex; gap: $hh-space-sm; margin-top: $hh-space-xs; }

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
.avatar-preview {
  width: 140rpx;
  height: 140rpx;
  border-radius: $hh-radius-full;
  background: $hh-color-bg-sub;
}
.avatar-hint {
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
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
.badges { display: flex; gap: $hh-space-xs; }
.badge { font-size: $hh-font-tag; padding: 4rpx 12rpx; border-radius: $hh-radius-lg; }
.badge.admin { background: #e3f2fd; color: #1565c0; }
.badge.current { background: #e8f5e9; color: #2e7d32; }
.empty { color: $hh-color-text-mute; font-size: $hh-font-body; padding: $hh-space-md 0; }
.join-btn { margin-top: $hh-space-md; }
.approval-item { display: flex; justify-content: space-between; align-items: center; padding: $hh-space-md 0; border-bottom: 1rpx solid $hh-color-divider; }
.member-id { font-size: $hh-font-caption; color: $hh-color-text-sub; font-family: monospace; }
.approval-actions { display: flex; gap: $hh-space-sm; }

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

.input-wrap { background: $hh-color-bg-sub; border-radius: $hh-radius-sm; padding: $hh-space-md; }
.input { font-size: $hh-font-body; width: 100%; min-height: 40rpx; background: transparent; color: $hh-color-text; }
.input-placeholder { color: $hh-color-text-mute; font-size: $hh-font-body; }
.dev-login-btn { background: $hh-color-text; color: $hh-color-text-inverse; }
.approve-btn { background: $hh-color-info; color: $hh-color-text-inverse; }
</style>
