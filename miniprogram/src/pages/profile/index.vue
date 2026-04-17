<template>
  <view class="profile-page">
    <!-- User info -->
    <view class="user-card">
      <image :src="userStore.avatarUrl || '/static/default-avatar.png'" class="avatar" />
      <view class="user-info">
        <text class="name">{{ userStore.nickName || '未登录' }}</text>
        <view v-if="!userStore.isLoggedIn" class="login-actions">
          <button size="mini" @tap="handleLogin">微信登录</button>
          <button size="mini" @tap="showDevLogin = true" class="dev-btn">DEV 登录</button>
        </view>
        <button v-else size="mini" @tap="handleLogout">登出</button>
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
import { ref, onMounted } from 'vue'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { memberApi } from '../../api/cloud'
import { useBusyLock, useKeyedBusyLock } from '../../utils/useBusyLock'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const pendingMembers = ref<any[]>([])
const adminCommunityIds = ref<string[]>([])

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

const loginLock = useBusyLock(async () => {
  try {
    await userStore.login()
    await communityStore.loadMyCommunities()
  } catch (e) {
    uni.showToast({ title: '登录失败', icon: 'none' })
  }
})
const handleLogin = loginLock.run

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

onMounted(async () => {
  if (!userStore.isLoggedIn) return
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
})
</script>

<style lang="scss" scoped>
.profile-page { padding: $hh-space-lg; background: $hh-color-bg-sub; min-height: 100vh; }
.user-card { background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-lg; display: flex; align-items: center; margin-bottom: $hh-space-md; }
.avatar { width: 100rpx; height: 100rpx; border-radius: $hh-radius-full; margin-right: $hh-space-md; }
.name { font-size: $hh-font-h3; font-weight: $hh-font-weight-bold; color: $hh-color-text; display: block; }
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
