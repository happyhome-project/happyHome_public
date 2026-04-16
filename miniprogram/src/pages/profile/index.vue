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
          <button size="mini" :disabled="devLoginLock.busy.value" @tap="devLoginLock.run()" style="background:#333;color:#fff;">
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
            style="background:#1976d2;color:#fff;"
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

<style scoped>
.profile-page { padding: 32rpx; background: #f5f5f5; min-height: 100vh; }
.user-card { background: #fff; border-radius: 16rpx; padding: 32rpx; display: flex; align-items: center; margin-bottom: 24rpx; }
.avatar { width: 100rpx; height: 100rpx; border-radius: 50%; margin-right: 24rpx; }
.name { font-size: 34rpx; font-weight: 600; }
.section { background: #fff; border-radius: 16rpx; padding: 24rpx 32rpx; margin-bottom: 24rpx; }
.section-title { font-size: 28rpx; color: #999; display: block; margin-bottom: 20rpx; }
.list-item { display: flex; justify-content: space-between; align-items: center; padding: 20rpx 0; border-bottom: 1rpx solid #f5f5f5; }
.item-name { font-size: 30rpx; color: #333; }
.badges { display: flex; gap: 8rpx; }
.badge { font-size: 22rpx; padding: 4rpx 12rpx; border-radius: 20rpx; }
.badge.admin { background: #e3f2fd; color: #1565c0; }
.badge.current { background: #e8f5e9; color: #2e7d32; }
.empty { color: #ccc; font-size: 28rpx; padding: 20rpx 0; }
.join-btn { margin-top: 20rpx; }
.approval-item { display: flex; justify-content: space-between; align-items: center; padding: 20rpx 0; border-bottom: 1rpx solid #f5f5f5; }
.member-id { font-size: 26rpx; color: #666; font-family: monospace; }
.approval-actions { display: flex; gap: 12rpx; }

.login-actions { display: flex; gap: 12rpx; }
.dev-btn { background: #f90; color: #fff; font-size: 24rpx; }

.dev-modal-mask {
  /* 微信小程序对 CSS `inset` shorthand 支持不稳定，用显式四边 */
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.dev-modal {
  background: #fff; border-radius: 16rpx;
  padding: 40rpx 32rpx; width: 84%; max-width: 600rpx;
  display: flex; flex-direction: column; gap: 20rpx;
}
.dev-title { font-size: 32rpx; font-weight: 600; text-align: center; }
.dev-desc { font-size: 24rpx; color: #999; line-height: 1.5; }
.dev-actions { display: flex; gap: 16rpx; margin-top: 8rpx; }
.dev-actions button { flex: 1; }

.input-wrap { background: #f8f8f8; border-radius: 12rpx; padding: 20rpx 24rpx; }
.input { font-size: 28rpx; width: 100%; min-height: 40rpx; background: transparent; }
.input-placeholder { color: #bbb; font-size: 28rpx; }
</style>
