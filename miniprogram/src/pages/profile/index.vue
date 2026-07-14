<template>
  <view
    class="profile-page"
    data-testid="profile-page"
    :data-build-version="releaseVersion"
    :class="{ 'profile-page--editing': showManualLoginForm }"
  >
    <view
      class="profile-page-background"
      :inert="isEditingProfile"
      :aria-hidden="isEditingProfile ? 'true' : undefined"
    >
    <view class="profile-custom-nav" :style="profileCustomNavStyle">
      <view class="profile-custom-nav-row">
        <text class="profile-custom-nav-title">我的</text>
      </view>
    </view>

    <view v-if="profileError" class="profile-error">
      <text>{{ profileError }}</text>
    </view>
    <view class="user-card" :class="{ 'user-card--form': showManualLoginForm }">
      <!-- 已登录：编辑时仍保留身份卡，表单由页面底部浮层承载 -->
      <template v-if="userStore.isLoggedIn">
        <image :src="profileAvatarSrc" class="avatar" />
        <view class="user-info">
          <view class="name-row">
            <text class="name">{{ profileDisplayName }}</text>
            <text v-if="isCurrentCommunityAdmin" class="profile-admin-badge">管理员</text>
          </view>
          <view class="profile-community-row">
            <text class="profile-community-name">{{ currentCommunityName }}</text>
            <view class="profile-switch" @tap="goOnboarding">
              <image class="profile-switch-icon" src="/static/profile/switch.svg" mode="aspectFit" />
              <text>切换</text>
            </view>
          </view>
        </view>
        <view class="profile-edit-link" @tap="startEditProfile">
          <text>编辑</text>
          <image class="profile-edit-arrow" src="/static/profile/edit-arrow.svg" mode="aspectFit" />
        </view>
      </template>

      <template v-else-if="showManualLoginForm">
        <view class="login-form">
          <text class="form-title">登录</text>
          <!-- #ifdef H5 -->
          <text class="form-hint">使用 CloudBase Web 账号登录</text>
          <view class="input-wrap">
            <text class="input-label">用户名</text>
            <input v-model="webUsername" data-testid="h5-login-username" autocomplete="username" aria-label="用户名" placeholder="请输入用户名" placeholder-class="input-placeholder" class="input" />
          </view>
          <view class="input-wrap">
            <text class="input-label">密码</text>
            <input v-model="webPassword" data-testid="h5-login-password" password autocomplete="current-password" aria-label="密码" placeholder="请输入密码" placeholder-class="input-placeholder" class="input" />
          </view>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <text class="form-hint">当前环境不支持微信原生登录，请手动填写昵称后继续使用社区功能</text>

          <view class="avatar-row">
            <image
              :src="formAvatarDisplay || profileAvatarSrc"
              class="avatar-preview"
            />
            <text class="avatar-hint">默认头像</text>
          </view>
          <!-- #endif -->

          <view class="input-wrap">
            <input
              type="nickname"
              data-testid="h5-login-nickname"
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
            <button size="mini" @tap="closeManualLoginForm">取消</button>
            <button
              size="mini"
              :disabled="!canSubmitForm || submitFormLock.busy.value"
              class="primary-btn"
              data-testid="h5-login-submit"
              @tap="submitFormLock.run()"
            >
              {{ submitFormLock.busy.value ? '登录中...' : '确认登录' }}
            </button>
            <!-- #ifndef H5 -->
            <button
              v-if="developerToolsEnabled"
              size="mini"
              class="dev-btn"
              @tap="showDevLogin = true"
            >DEV 登录</button>
            <!-- #endif -->
          </view>
        </view>
      </template>

      <template v-else>
        <image :src="profileAvatarSrc" class="avatar" @tap="openLoginEntry" />
        <view class="user-info" @tap="openLoginEntry">
          <view class="name-row">
            <text class="name">{{ profileDisplayName }}</text>
          </view>
        </view>
        <!-- #ifndef H5 -->
        <view v-if="developerToolsEnabled" class="login-alt-row">
          <text class="login-alt-link" @tap.stop="showDevLogin = true">DEV 登录</text>
        </view>
        <!-- #endif -->
        <button
          v-if="supportsChooseAvatar"
          open-type="chooseAvatar"
          class="profile-login-hit"
          data-testid="profile-login-entry"
          @chooseavatar="onLoginChooseAvatar"
        ></button>
        <button
          v-else
          class="profile-login-hit"
          data-testid="profile-login-entry"
          @tap.stop="openLoginEntry"
        ></button>
      </template>
    </view>

    <view v-if="developerToolsEnabled && !isEditingProfile && !showManualLoginForm" class="profile-diagnostics">
      <view class="profile-diagnostics__header">
        <text>Home 诊断</text>
        <text class="profile-diagnostics__state">{{ diagnosticsState.enabled ? '已开启' : '未开启' }}</text>
      </view>
      <text class="profile-diagnostics__hint">仅记录启动与渲染阶段，30 分钟后自动关闭。</text>
      <view class="profile-diagnostics__actions">
        <switch :checked="diagnosticsState.enabled" color="#36b37e" @change="toggleHomeDiagnostics" />
        <button size="mini" @tap="flushHomeDiagnostics">上传诊断</button>
        <button size="mini" @tap="clearHomeDiagnostics">清空</button>
      </view>
      <text v-if="diagnosticsStatus" class="profile-diagnostics__hint">{{ diagnosticsStatus }}</text>
    </view>

    <view v-if="!showManualLoginForm" class="profile-shortcuts">
      <view class="profile-shortcut create" @tap="goOnboarding">
        <image
          class="profile-shortcut-decoration"
          src="/static/profile/shortcut-create-bg.svg"
          mode="aspectFit"
        />
        <text class="shortcut-title">创建社区</text>
        <view class="shortcut-icon shortcut-icon--create">
          <image class="shortcut-icon-image" src="/static/profile/create-community.svg" mode="aspectFit" />
        </view>
      </view>
      <view class="profile-shortcut join" @tap="goOnboarding">
        <image
          class="profile-shortcut-decoration"
          src="/static/profile/shortcut-join-bg.svg"
          mode="aspectFit"
        />
        <text class="shortcut-title">加入社区</text>
        <view class="shortcut-icon shortcut-icon--join" aria-hidden="true">
          <image
            class="shortcut-icon-image shortcut-icon-image--join-front"
            src="/static/profile/join-community-front.svg"
            mode="aspectFit"
          />
          <image
            class="shortcut-icon-image shortcut-icon-image--join-back"
            src="/static/profile/join-community-back.svg"
            mode="aspectFit"
          />
          <image
            class="shortcut-icon-image shortcut-icon-image--join-pin"
            src="/static/profile/join-community-pin.svg"
            mode="aspectFit"
          />
        </view>
      </view>
    </view>

    <view v-if="!showManualLoginForm" class="profile-tools-card">
      <template v-for="item in profileToolItems" :key="item.key">
        <button
          v-if="item.kind === 'contact'"
          class="profile-tool"
          open-type="contact"
          show-message-card
          send-message-title="HappyHome 使用反馈"
          send-message-path="/pages/profile/index"
        >
          <view class="profile-tool-icon">
            <image
              class="profile-tool-icon-image"
              :class="`profile-tool-icon-image--${item.tone}`"
              :src="item.iconSrc"
              mode="aspectFit"
            />
          </view>
          <text class="profile-tool-label">{{ item.label }}</text>
        </button>
        <view v-else class="profile-tool" @tap="handleProfileTool(item)">
          <view class="profile-tool-icon">
            <image
              class="profile-tool-icon-image"
              :class="`profile-tool-icon-image--${item.tone}`"
              :src="item.iconSrc"
              mode="aspectFit"
            />
          </view>
          <text class="profile-tool-label">{{ item.label }}</text>
        </view>
      </template>
    </view>

    <button
      v-if="!showManualLoginForm"
      class="profile-primary-action"
      open-type="share"
      @tap="handleInviteTap"
    >邀请好友加入社区</button>

    <button
      v-if="!showManualLoginForm"
      class="profile-secondary-action"
      :disabled="leaveCurrentCommunityLock.isBusy"
      @tap="handleLeaveCurrentCommunity"
    >
      {{ leaveCurrentCommunityLock.isBusy ? '退出中...' : '退出当前社区' }}
    </button>

    <!-- #ifdef H5 -->
    <button
      v-if="userStore.isLoggedIn && !showManualLoginForm"
      class="profile-secondary-action profile-secondary-action--logout"
      data-testid="h5-logout"
      :disabled="webLogoutLock.busy.value"
      @tap="webLogoutLock.run()"
    >{{ webLogoutLock.busy.value ? '退出中...' : '退出登录' }}</button>
    <!-- #endif -->

    <!-- 昵称确认浮层：chooseAvatar 回调后自动弹出 -->
    <view v-if="showNickConfirm" class="nick-modal-mask" @tap="cancelNickConfirm">
      <view class="nick-modal" @tap.stop>
        <image
          :src="formAvatarDisplay || profileAvatarSrc"
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

    <!-- #ifndef H5 -->
    <!-- DEV login modal -->
    <view v-if="developerToolsEnabled && showDevLogin" class="dev-modal-mask" @tap="showDevLogin = false">
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
    <!-- #endif -->

    <!-- Pending approvals (admin only) -->
    <view v-if="pendingApprovalCount > 0" class="section approval-section">
      <view class="section-title-row">
        <text class="section-title">审批中心</text>
        <text class="section-count">{{ pendingApprovalCount }} 项待处理</text>
      </view>
      <view
        v-if="approvalReminderState.kind !== 'hidden'"
        class="approval-reminder-card"
      >
        <view class="approval-reminder-copy">
          <text class="approval-reminder-title">{{ approvalReminderState.title }}</text>
          <text class="approval-reminder-desc">{{ approvalReminderState.message }}</text>
        </view>
        <button
          v-if="approvalReminderState.kind === 'prompt'"
          size="mini"
          class="approval-reminder-btn"
          :disabled="notificationSubscribeLock.busy.value"
          @tap="notificationSubscribeLock.run()"
        >
          {{ notificationSubscribeLock.busy.value ? '开启中...' : '开启' }}
        </button>
      </view>

      <view v-if="pendingCommunities.length > 0" class="approval-group">
        <text class="approval-group-title">新建社区</text>
        <view v-for="community in pendingCommunities" :key="community._id" class="approval-item">
          <view class="approval-main">
            <text class="approval-name">{{ community.name || '未命名社区' }}</text>
            <text class="approval-meta">创建者 {{ shortId(community.creatorId) }} · {{ formatDate(community.createdAt) }}</text>
          </view>
          <view class="approval-actions">
            <button
              size="mini"
              :disabled="approveCommunityLock.isBusy(community._id) || rejectCommunityLock.isBusy(community._id)"
              @tap="approveCommunityLock.run(community)"
              class="approve-btn"
            >通过</button>
            <button
              size="mini"
              :disabled="approveCommunityLock.isBusy(community._id) || rejectCommunityLock.isBusy(community._id)"
              @tap="rejectCommunityLock.run(community)"
            >拒绝</button>
          </view>
        </view>
      </view>

      <view v-if="pendingMembers.length > 0" class="approval-group">
        <text class="approval-group-title">成员加入</text>
        <view v-for="member in pendingMembers" :key="member._id" class="approval-item">
          <view class="approval-main">
            <text class="approval-name">{{ member.communityName || '社区成员申请' }}</text>
            <text class="approval-meta">用户 {{ shortId(member.userId) }} · {{ formatDate(member.appliedAt) }}</text>
          </view>
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
    <CommunityShareImageCanvas
      :community-id="currentShareCommunityId"
      :community-name="currentCommunityName"
      :cover-image="currentCommunityCoverImage"
      @update:image-url="shareImageUrl = $event"
    />
    <AppTabBar current="profile" />
    </view>

    <view
      v-if="isEditingProfile"
      class="profile-edit-mask"
      @tap="cancelEditProfile"
      @touchmove.stop.prevent
    >
      <view
        class="profile-edit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-edit-sheet-title"
        @tap.stop
        @touchmove.stop
      >
        <text id="profile-edit-sheet-title" class="profile-edit-sheet__title">编辑资料</text>

        <view class="profile-edit-sheet__avatar-row">
          <button
            v-if="supportsChooseAvatar"
            open-type="chooseAvatar"
            class="avatar-picker-btn"
            :disabled="submitFormLock.busy.value"
            @chooseavatar="onChooseAvatar"
          >
            <view class="avatar-edit-wrap">
              <image :src="formAvatarDisplay || profileAvatarSrc" class="avatar-preview" />
              <view class="avatar-edit-badge" aria-hidden="true">
                <view class="avatar-edit-camera">
                  <view class="avatar-edit-camera-lens"></view>
                </view>
              </view>
            </view>
          </button>
          <image v-else :src="formAvatarDisplay || profileAvatarSrc" class="avatar-preview" />
          <text class="profile-edit-sheet__capability">
            {{ supportsChooseAvatar ? '点击头像即可更换' : '当前基础库暂不支持修改头像' }}
          </text>
        </view>

        <view class="profile-edit-sheet__field">
          <text class="profile-edit-sheet__label">昵称</text>
          <view class="profile-edit-sheet__input-wrap">
            <input
              type="nickname"
              aria-label="昵称"
              :focus="isEditingProfile"
              :value="formNickName"
              placeholder="请输入昵称"
              placeholder-class="input-placeholder"
              maxlength="20"
              class="input"
              @input="onNickInput"
              @blur="onNickBlur"
            />
          </view>
        </view>

        <view class="profile-edit-sheet__actions">
          <button
            class="profile-edit-sheet__cancel"
            :disabled="submitFormLock.busy.value"
            @tap="cancelEditProfile"
          >取消</button>
          <button
            class="profile-edit-sheet__save"
            :disabled="!canSubmitForm || submitFormLock.busy.value"
            @tap="saveProfile"
          >{{ submitFormLock.busy.value ? '保存中...' : '保存' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { onPullDownRefresh, onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { communityApi, memberApi, notificationApi, type ApprovalNotificationEventType } from '../../api/cloud'
import { uploadCloudFile } from '../../api/storage'
import AppTabBar from '../../components/AppTabBar.vue'
import CommunityShareImageCanvas from '../../components/CommunityShareImageCanvas.vue'
import { hideNativeTabBar } from '../../utils/app-tabbar'
import { useBusyLock, useKeyedBusyLock } from '../../utils/useBusyLock'
import { createProfileEditSessionGuard, resolveProfileAvatarUrl } from '../../utils/profile-edit-session'
import { clientLog, flushClientDiagnostics } from '../../utils/client-log'
import {
  clearClientDiagnosticEvents,
  disableClientDiagnostics,
  enableClientDiagnostics,
  getClientDiagnosticsState,
} from '../../utils/client-diagnostics'
import { openOnboardingPreservingStack } from '../../utils/onboarding-nav'
import { getReleaseVersion } from '../../utils/release-version'
import {
  buildApprovalReminderState,
  buildSubscriptionSaves,
  configuredApprovalTemplates,
  approvalReminderErrorMessage,
  saveApprovalSubscriptionWithRetry,
  uniqueTemplateIds,
  type ApprovalNotificationTemplate,
} from '../../utils/approval-notification'
import {
  buildCommunitySharePath,
  buildCommunityShareTitle,
  consumePendingShareCommunity,
} from '../../utils/community-share'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const pendingCommunities = ref<any[]>([])
const pendingMembers = ref<any[]>([])
const adminCommunityIds = ref<string[]>([])
const notificationTemplates = ref<ApprovalNotificationTemplate[]>([])
const notificationSubscriptions = ref<Array<{ eventType: ApprovalNotificationEventType; templateId: string; status: string }>>([])
const notificationNeedsAuthorization = ref(false)
const profileError = ref('')
const shareImageUrl = ref('')
const releaseVersion = getReleaseVersion()
const diagnosticsState = ref(getClientDiagnosticsState())
const diagnosticsStatus = ref('')
const developerToolsEnabled = computed(() => {
  try {
    const envVersion = String((wx as any)?.getAccountInfoSync?.()?.miniProgram?.envVersion || '')
    const isDeveloperEnvironment = envVersion === 'develop' || envVersion === 'trial'
    return isDeveloperEnvironment && uni.getStorageSync('hh-profile-developer-tools') === '1'
  } catch (_error) {
    return false
  }
})
const profileStatusBarHeight = ref(44)
const profileNavRowHeight = ref(54)
const profileCustomNavStyle = computed(() => (
  `padding-top: ${profileStatusBarHeight.value}px; --profile-nav-row-height: ${profileNavRowHeight.value}px;`
))
let refreshingProfile = false
let lastLoginStateRefreshKey = ''
let suppressNextLoginStateRefresh = false

type ProfileToolItem = {
  key: string
  label: string
  iconSrc: string
  tone: 'heart' | 'like' | 'archive' | 'activity' | 'post' | 'checkin' | 'service'
  kind?: 'contact'
}

const profileToolItems: ProfileToolItem[] = [
  { key: 'favorite', label: '我的收藏', iconSrc: '/static/profile/favorite.svg', tone: 'heart' },
  { key: 'like', label: '我的点赞', iconSrc: '/static/profile/like.svg', tone: 'like' },
  { key: 'archive', label: '我的归档', iconSrc: '/static/profile/archive.svg', tone: 'archive' },
  { key: 'activity', label: '我的活动', iconSrc: '/static/profile/activity.svg', tone: 'activity' },
  { key: 'posts', label: '我发布的', iconSrc: '/static/profile/posts.svg', tone: 'post' },
  { key: 'checkin', label: '打卡记录', iconSrc: '/static/profile/checkin.svg', tone: 'checkin' },
  { key: 'service', label: '联系客服', iconSrc: '/static/profile/service.svg', tone: 'service', kind: 'contact' },
]

const configuredNotificationTemplates = computed(() => configuredApprovalTemplates(notificationTemplates.value))
const hasAdminTools = computed(() => userStore.role === 'superAdmin' || adminCommunityIds.value.length > 0)
const pendingApprovalCount = computed(() => pendingCommunities.value.length + pendingMembers.value.length)
const currentCommunity = computed(() => {
  const currentId = String(communityStore.currentCommunityId || '')
  return communityStore.currentCommunity ||
    communityStore.myCommunities.find((community: any) => String(community?._id || '') === currentId) ||
    null
})
const currentShareCommunityId = computed(() => String(currentCommunity.value?._id || communityStore.currentCommunityId || ''))
const currentCommunityName = computed(() => currentCommunity.value?.name || '暂无社区')
const currentCommunityCoverImage = computed(() => String(currentCommunity.value?.coverImage || '').trim())
const profileAvatarSrc = computed(() => userStore.avatarUrl || '/static/ai-avatars/avatar-01.svg')
const profileDisplayName = computed(() => userStore.isLoggedIn ? (userStore.nickName || '未命名') : '登录')
const isCurrentCommunityAdmin = computed(() => {
  const id = String(communityStore.currentCommunityId || '')
  return userStore.role === 'superAdmin' || (!!id && adminCommunityIds.value.includes(id))
})
const supportsSubscribeMessage = computed(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return typeof wx !== 'undefined' && typeof wx.requestSubscribeMessage === 'function'
})
const approvalReminderState = computed(() => buildApprovalReminderState({
  hasAdminTools: hasAdminTools.value,
  pendingApprovalCount: pendingApprovalCount.value,
  templates: notificationTemplates.value,
  subscriptions: notificationSubscriptions.value,
  supportsSubscribeMessage: supportsSubscribeMessage.value,
  backendNeedsAuthorization: notificationNeedsAuthorization.value,
}))

// ── 登录 / 编辑资料表单状态 ──
const isEditingProfile = ref(false)
const showManualLoginForm = ref(false)
const webUsername = ref('')
const webPassword = ref('')
const showNickConfirm = ref(false)    // 登录流程：chooseAvatar 后弹出昵称确认浮层
const formNickName = ref('')
const formAvatarCloudUrl = ref('')    // 已上传到 COS 的 cloud://… URL（持久）
const formAvatarTempPath = ref('')    // chooseAvatar 回传的临时路径（本次提交时上传 COS）
const profileEditSessionGuard = createProfileEditSessionGuard()
let activeProfileEditGeneration = 0

// 同时显示临时路径（用户刚选完、还没点提交）或已确认的 cloud URL
const formAvatarDisplay = computed(() => formAvatarTempPath.value || formAvatarCloudUrl.value)

// 是否支持 <button open-type="chooseAvatar">：需要基础库 ≥ 2.21.2，mp-weixin 环境
const supportsChooseAvatar = computed(() => {
  // H5 smoke uses this hook to exercise the real-phone chooseAvatar branch.
  if (typeof globalThis !== 'undefined' && (globalThis as any).__HH_TEST_CHOOSE_AVATAR__ === true) {
    return true
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof wx === 'undefined' || !wx?.canIUse) return false
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return !!wx.canIUse('button.open-type.chooseAvatar')
  } catch (_error) {
    return false
  }
})

// 表单是否可提交：至少要有昵称
const canSubmitForm = computed(() => {
  if (isH5Runtime() && showManualLoginForm.value && !isEditingProfile.value) {
    return webUsername.value.trim().length > 0 && webPassword.value.length > 0 && formNickName.value.trim().length > 0
  }
  return formNickName.value.trim().length > 0
})
const profileShellState = computed(() => {
  if (isEditingProfile.value) return 'editing'
  return userStore.isLoggedIn ? 'logged-in' : 'logged-out'
})

function getProfileLogDetails(extra: Record<string, any> = {}) {
  const details: Record<string, any> = {
    shellState: profileShellState.value,
    loggedIn: userStore.isLoggedIn,
    openIdTail: userStore.openId ? String(userStore.openId).slice(-6) : '',
    nickName: userStore.nickName || '',
    communityCount: communityStore.myCommunities.length,
    currentCommunityId: communityStore.currentCommunityId || '',
    hasAdminTools: hasAdminTools.value,
    pendingMemberCount: pendingMembers.value.length,
    pendingCommunityCount: pendingCommunities.value.length,
    pendingApprovalCount: pendingApprovalCount.value,
    adminCommunityCount: adminCommunityIds.value.length,
    refreshingProfile,
    profileError: profileError.value || '',
  }
  Object.keys(extra).forEach((key) => {
    details[key] = extra[key]
  })
  return details
}

function logProfile(level: 'debug' | 'info' | 'warn' | 'error', event: string, details: Record<string, any> = {}) {
  clientLog(level, event, getProfileLogDetails(details))
}

function refreshDiagnosticsState() {
  diagnosticsState.value = getClientDiagnosticsState()
}

function toggleHomeDiagnostics(event: any) {
  if (event?.detail?.value) {
    const state = enableClientDiagnostics({ scope: 'home' })
    diagnosticsState.value = state
    diagnosticsStatus.value = '已开始记录 Home 启动诊断'
    clientLog('info', 'profile.diagnostics.enabled', { traceId: state.traceId })
    return
  }
  disableClientDiagnostics()
  refreshDiagnosticsState()
  diagnosticsStatus.value = '诊断已关闭'
}

async function flushHomeDiagnostics() {
  const result = await flushClientDiagnostics()
  refreshDiagnosticsState()
  diagnosticsStatus.value = `已上传 ${result.uploaded}/${result.attempted} 条诊断`
}

function clearHomeDiagnostics() {
  clearClientDiagnosticEvents()
  diagnosticsStatus.value = '本机诊断已清空'
}

function getLoginStateRefreshKey() {
  if (!userStore.isLoggedIn) return ''
  return `${userStore.openId || 'pending-openid'}:${userStore.role || 'user'}`
}

function markCurrentLoginStateRefreshHandled() {
  const key = getLoginStateRefreshKey()
  if (key) lastLoginStateRefreshKey = key
  suppressNextLoginStateRefresh = false
}

function onChooseAvatar(e: any) {
  const tempPath = e?.detail?.avatarUrl || ''
  if (tempPath) {
    formAvatarTempPath.value = tempPath
  }
}

// 未登录态点身份区 → 微信弹 chooseAvatar → 回调后自动弹昵称确认浮层。
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

async function uploadAvatarIfAny(selectedTempPath: string, existingAvatarUrl: string, strictReplacement: boolean): Promise<string> {
  return resolveProfileAvatarUrl({
    selectedTempPath,
    existingAvatarUrl,
    strictReplacement,
    uploadSelectedAvatar: async (source) => {
      const ext = source.startsWith('blob:')
      ? 'jpg'
        : (source.split('.').pop()?.split('?')[0] || 'jpg')
      const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      return uploadCloudFile({ cloudPath, source })
    },
  })
}

function startEditProfile() {
  const generation = profileEditSessionGuard.tryStart(submitFormLock.busy.value)
  if (generation === null) return
  activeProfileEditGeneration = generation
  isEditingProfile.value = true
  formNickName.value = userStore.nickName || ''
  formAvatarCloudUrl.value = userStore.avatarUrl || ''
  formAvatarTempPath.value = ''
}

function cancelEditProfile() {
  if (!profileEditSessionGuard.requestClose(submitFormLock.busy.value)) return
  isEditingProfile.value = false
  formNickName.value = ''
  formAvatarCloudUrl.value = ''
  formAvatarTempPath.value = ''
}

const submitFormLock = useBusyLock(async () => {
  const wasEditingProfile = isEditingProfile.value
  const editGeneration = activeProfileEditGeneration
  const submittedNickName = formNickName.value
  const submittedAvatarTempPath = formAvatarTempPath.value
  const submittedAvatarCloudUrl = formAvatarCloudUrl.value
  try {
    const avatarUrl = await uploadAvatarIfAny(submittedAvatarTempPath, submittedAvatarCloudUrl, wasEditingProfile)
    suppressNextLoginStateRefresh = true
    if (isH5Runtime() && !wasEditingProfile) {
      await userStore.webLogin({
        username: webUsername.value,
        password: webPassword.value,
        nickName: submittedNickName,
      })
    } else {
      await userStore.login({ nickName: submittedNickName, avatarUrl })
    }
    markCurrentLoginStateRefreshHandled()
    if (wasEditingProfile) await loadProfileDataAfterRoleResolved('profileSaved')
    else await loadProfileDataAfterRoleResolved('loginSaved')
    if (wasEditingProfile && !profileEditSessionGuard.complete(editGeneration)) return
    isEditingProfile.value = false
    showManualLoginForm.value = false
    showNickConfirm.value = false
    formAvatarTempPath.value = ''
    formAvatarCloudUrl.value = ''
    webPassword.value = ''
    const restoredShare = !wasEditingProfile && restorePendingShareCommunity()
    if (!restoredShare) {
      uni.showToast({ title: wasEditingProfile ? '已保存' : '登录成功', icon: 'success' })
    }
  } catch (e: any) {
    uni.showModal({
      title: wasEditingProfile ? '保存失败' : '登录失败',
      content: e?.message || '请重试',
      showCancel: false,
    })
    suppressNextLoginStateRefresh = false
    webPassword.value = ''
  }
})

function saveProfile() {
  return submitFormLock.run()
}

function closeManualLoginForm() {
  showManualLoginForm.value = false
  webPassword.value = ''
}

const webLogoutLock = useBusyLock(async () => {
  try {
    await userStore.logout()
  } catch (e: any) {
    uni.showModal({ title: '退出登录失败', content: e?.message || '请重试', showCancel: false })
  }
})

// DEV login modal state
const showDevLogin = ref(false)
const devOpenid = ref('')
const devNickname = ref('')
const devLoginLock = useBusyLock(async () => {
  try {
    suppressNextLoginStateRefresh = true
    await userStore.devLogin(devOpenid.value, devNickname.value)
    markCurrentLoginStateRefreshHandled()
    await loadProfileDataAfterRoleResolved('devLogin')
    showDevLogin.value = false
    devOpenid.value = ''
    devNickname.value = ''
    const restoredShare = restorePendingShareCommunity()
    if (!restoredShare) {
      uni.showToast({ title: '登录成功', icon: 'success' })
    }
  } catch (e: any) {
    uni.showModal({ title: '登录失败', content: e?.message || '请检查 openid 格式', showCancel: false })
    suppressNextLoginStateRefresh = false
  }
})

function isH5Runtime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function updateProfileNavMetrics() {
  let statusBarHeight = isH5Runtime() ? 44 : 20
  let navRowHeight = 54

  try {
    const systemInfo = uni.getSystemInfoSync?.()
    const measuredStatusBar = Number(systemInfo?.statusBarHeight || 0)
    if (measuredStatusBar > 0) statusBarHeight = measuredStatusBar
  } catch (_error) {}

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof wx !== 'undefined' && typeof wx.getMenuButtonBoundingClientRect === 'function') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const menuTop = Number(menuRect?.top || 0)
      const menuHeight = Number(menuRect?.height || 0)
      if (menuHeight > 0) {
        const verticalGap = Math.max(0, menuTop - statusBarHeight)
        navRowHeight = Math.max(54, menuHeight + verticalGap * 2)
      }
    }
  } catch (_error) {}

  profileStatusBarHeight.value = Math.max(0, Math.round(statusBarHeight))
  profileNavRowHeight.value = Math.max(44, Math.round(navRowHeight))
}

function openLoginEntry() {
  if (userStore.isLoggedIn) return
  if (supportsChooseAvatar.value) return
  webPassword.value = ''
  showManualLoginForm.value = true
}

function goOnboarding() {
  openOnboardingPreservingStack({ mode: 'discover' })
}

function handleProfileTool(item: ProfileToolItem) {
  if (!userStore.isLoggedIn) {
    openLoginEntry()
    return
  }
  uni.showToast({ title: `${item.label}暂未开放`, icon: 'none' })
}

function handleInviteTap() {
  if (!currentShareCommunityId.value) {
    uni.showToast({ title: '暂无可邀请社区', icon: 'none' })
    return
  }
  if (isH5Runtime()) {
    uni.showToast({ title: '请在小程序内分享', icon: 'none' })
  }
}

function restorePendingShareCommunity() {
  const communityId = consumePendingShareCommunity()
  if (!communityId) return false
  openOnboardingPreservingStack({ mode: 'discover', communityId })
  return true
}

function canLeaveCommunity(community: any) {
  return String(community?.creatorId || '') !== String(userStore.openId || '')
}

function shortId(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return '未知'
  if (text.length <= 8) return text
  return `${text.slice(0, 8)}...`
}

function formatDate(value: unknown) {
  const timestamp = Date.parse(String(value || ''))
  if (Number.isNaN(timestamp)) return '时间未知'
  const date = new Date(timestamp)
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
        openOnboardingPreservingStack()
      }
    } catch (e: any) {
      uni.showToast({ title: e?.message || '退出失败', icon: 'none' })
    }
  },
  (community) => String(community?._id || ''),
)

const leaveCurrentCommunityLock = computed(() => {
  const id = String(currentCommunity.value?._id || '')
  return { isBusy: !!id && leaveCommunityLock.isBusy(id) }
})

function handleLeaveCurrentCommunity() {
  if (!userStore.isLoggedIn) {
    openLoginEntry()
    return
  }
  if (!currentCommunity.value) {
    uni.showToast({ title: '暂无当前社区', icon: 'none' })
    return
  }
  leaveCommunityLock.run(currentCommunity.value)
}

const approveCommunityLock = useKeyedBusyLock(
  async (community: any) => {
    try {
      await communityApi.approve(String(community._id || ''))
      pendingCommunities.value = pendingCommunities.value.filter((item) => item._id !== community._id)
      uni.showToast({ title: '社区已通过', icon: 'success' })
    } catch (e: any) {
      uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
    }
  },
  (community) => String(community?._id || ''),
)

const rejectCommunityLock = useKeyedBusyLock(
  async (community: any) => {
    try {
      await communityApi.reject(String(community._id || ''))
      pendingCommunities.value = pendingCommunities.value.filter((item) => item._id !== community._id)
      uni.showToast({ title: '社区已拒绝', icon: 'none' })
    } catch (e: any) {
      uni.showToast({ title: e?.message || '操作失败', icon: 'none' })
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
    uni.showToast({ title: '提醒模板尚未配置', icon: 'none' })
    return
  }
  if (!supportsSubscribeMessage.value) {
    uni.showToast({ title: '请在真机微信中开启提醒', icon: 'none' })
    return
  }

  try {
    const result: Record<string, string> = await new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      wx.requestSubscribeMessage({
        tmplIds: uniqueTemplateIds(templates),
        success: resolve,
        fail: reject,
      })
    })

    const saves = buildSubscriptionSaves(templates, result)
    for (const item of saves) {
      await saveApprovalSubscriptionWithRetry(item, notificationApi.saveSubscription)
    }
    await loadNotificationStatus()
    const accepted = saves.some((item) => item.status === 'accept')
    uni.showToast({
      title: accepted ? '审批提醒已开启' : '未开启提醒，可稍后再试',
      icon: accepted ? 'success' : 'none',
    })
  } catch (e: any) {
    uni.showToast({ title: approvalReminderErrorMessage(e), icon: 'none' })
  }
})

async function loadPendingMembers() {
  if (!userStore.isLoggedIn) return
  const nextPendingMembers: any[] = []
  const nextAdminCommunityIds: string[] = []
  let communitiesToCheck = communityStore.myCommunities

  if (userStore.role === 'superAdmin') {
    try {
      const res = await communityApi.list(false)
      communitiesToCheck = Array.isArray(res.communities) ? res.communities : []
    } catch (_error) {
      communitiesToCheck = communityStore.myCommunities
    }
  }

  for (const community of communitiesToCheck) {
    const communityId = String(community?._id || '')
    if (!communityId) continue
    try {
      const res = await memberApi.pendingList(communityId)
      nextAdminCommunityIds.push(communityId)
      if (Array.isArray(res.members) && res.members.length > 0) {
        for (const member of res.members) {
          const normalized = Object.assign({}, member)
          normalized.communityId = communityId
          normalized.communityName = community?.name || ''
          nextPendingMembers.push(normalized)
        }
      }
    } catch (_error) {
      // pendingList only succeeds for communities this user can administer.
    }
  }

  pendingMembers.value = nextPendingMembers
  adminCommunityIds.value = nextAdminCommunityIds
}

async function loadPendingCommunities() {
  if (!userStore.isLoggedIn || userStore.role !== 'superAdmin') {
    pendingCommunities.value = []
    return
  }
  try {
    const res = await communityApi.pendingList()
    pendingCommunities.value = Array.isArray(res.communities) ? res.communities : []
  } catch (_error) {
    pendingCommunities.value = []
  }
}

async function loadNotificationSubscriptions(options: { preserveOnFailure?: boolean } = {}) {
  if (!userStore.isLoggedIn) return
  try {
    const res = await notificationApi.status()
    notificationSubscriptions.value = Array.isArray(res.subscriptions) ? res.subscriptions : []
    notificationNeedsAuthorization.value = !!res.needsAuthorization
  } catch (_error) {
    if (!options.preserveOnFailure) {
      notificationSubscriptions.value = []
      notificationNeedsAuthorization.value = false
    }
  }
}

async function loadNotificationStatus() {
  return loadNotificationSubscriptions()
}

async function loadNotificationConfig() {
  if (!userStore.isLoggedIn) return
  try {
    const res = await notificationApi.config()
    notificationTemplates.value = Array.isArray(res.templates) ? res.templates : []
  } catch (_error) {
    notificationTemplates.value = []
  }
}

async function loadProfileDataAfterRoleResolved(reason: string) {
  await communityStore.loadMyCommunities()
  logProfile('info', 'profile.communities.load.success', {
    reason,
    loadedCommunityCount: communityStore.myCommunities.length,
  })
  await loadPendingCommunities()
  await loadPendingMembers()
  logProfile('info', 'profile.pending.load.success', {
    reason,
    pendingCommunityCount: pendingCommunities.value.length,
    pendingMemberCount: pendingMembers.value.length,
    pendingApprovalCount: pendingApprovalCount.value,
    adminCommunityCount: adminCommunityIds.value.length,
  })
  if (hasAdminTools.value) {
    await loadNotificationConfig()
    await loadNotificationSubscriptions()
    logProfile('info', 'profile.notifications.load.success', {
      reason,
      templateCount: configuredNotificationTemplates.value.length,
      subscriptionCount: notificationSubscriptions.value.length,
    })
  } else {
    notificationTemplates.value = []
    notificationSubscriptions.value = []
    notificationNeedsAuthorization.value = false
  }
}

async function refreshProfileData(reason = 'manual') {
  if (refreshingProfile) {
    logProfile('warn', 'profile.refresh.skip.busy', { reason })
    return
  }
  if (!userStore.isLoggedIn) {
    profileError.value = ''
    logProfile('warn', 'profile.refresh.skip.loggedOut', { reason })
    return
  }
  refreshingProfile = true
  profileError.value = ''
  logProfile('info', 'profile.refresh.start', { reason })
  try {
    await userStore.refreshLoginRole()
    await loadProfileDataAfterRoleResolved(reason)
  } catch (error: any) {
    profileError.value = error?.message || 'profile refresh failed'
    logProfile('error', 'profile.refresh.fail', { reason, error })
  } finally {
    refreshingProfile = false
    logProfile('info', 'profile.refresh.done', { reason })
  }
}

watch(
  () => getLoginStateRefreshKey(),
  (key) => {
    if (!key) {
      lastLoginStateRefreshKey = ''
      suppressNextLoginStateRefresh = false
      return
    }
    if (key === lastLoginStateRefreshKey) return
    lastLoginStateRefreshKey = key
    if (suppressNextLoginStateRefresh) {
      suppressNextLoginStateRefresh = false
      return
    }
    void refreshProfileData('loginStateReady')
  },
  { flush: 'post' },
)

onMounted(() => {
  hideNativeTabBar()
  refreshDiagnosticsState()
  updateProfileNavMetrics()
  logProfile('info', 'profile.mounted', {})
  void nextTick(() => logProfile('info', 'profile.render.tick', { reason: 'mounted' }))
  void refreshProfileData('mounted')
})
// tabBar 切回 Profile 只触发 onShow，不会重新 mount。新申请者 / 被审批后的状态
// 需要在 onShow 重新拉取，否则 admin 在本 tab 看不到实时变动。
onShow(() => {
  hideNativeTabBar()
  updateProfileNavMetrics()
  logProfile('info', 'profile.show', {})
  void nextTick(() => logProfile('info', 'profile.render.tick', { reason: 'show' }))
  void refreshProfileData('show')
})

onPullDownRefresh(async () => {
  try {
    await refreshProfileData('pullDown')
  } catch {
    uni.showToast({ title: '刷新失败，请重试', icon: 'none' })
  } finally {
    uni.stopPullDownRefresh()
  }
})

onShareAppMessage(() => {
  const communityId = currentShareCommunityId.value
  const title = buildCommunityShareTitle(currentCommunityName.value)
  const path = communityId ? buildCommunitySharePath(communityId) : '/pages/index/index'
  return shareImageUrl.value ? { title, path, imageUrl: shareImageUrl.value } : { title, path }
})
</script>

<style lang="scss" scoped>
.profile-page { padding: $hh-space-lg var(--hh-page-x) calc(132rpx + env(safe-area-inset-bottom)); background: var(--hh-color-page); min-height: 100vh; }
.profile-error {
  margin-bottom: $hh-space-sm;
  padding: 12rpx 16rpx;
  border-radius: $hh-radius-sm;
  background: #fff5f5;
  color: #d93026;
  font-size: $hh-font-caption;
  line-height: 1.5;
}
.profile-diagnostics {
  margin: -4rpx 0 $hh-space-md;
  padding: $hh-space-md;
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  background: var(--hh-color-card);
  box-shadow: var(--hh-shadow-soft);
}
.profile-diagnostics__header { display: flex; align-items: center; justify-content: space-between; color: var(--hh-color-text-primary); font-size: var(--hh-text-body-size); font-weight: $hh-font-weight-bold; }
.profile-diagnostics__state { color: var(--hh-color-text-secondary); font-size: var(--hh-text-caption-size); font-weight: $hh-font-weight-regular; }
.profile-diagnostics__hint { display: block; margin-top: 8rpx; color: var(--hh-color-text-tertiary); font-size: var(--hh-text-caption-size); line-height: var(--hh-text-caption-line-height); }
.profile-diagnostics__actions { display: flex; align-items: center; gap: $hh-space-sm; margin-top: $hh-space-sm; }
.profile-diagnostics__actions button { margin: 0; font-size: var(--hh-text-caption-size); }
.user-card { background: var(--hh-color-card); border: 1rpx solid var(--hh-color-line); border-radius: var(--hh-radius-card); padding: $hh-space-lg; display: flex; align-items: center; margin-bottom: $hh-space-md; box-shadow: var(--hh-shadow-soft); }
.avatar { width: 100rpx; height: 100rpx; border-radius: $hh-radius-full; margin-right: $hh-space-md; }
.name { font-size: var(--hh-text-heading-sm-size); font-weight: $hh-font-weight-bold; color: var(--hh-color-text-primary); display: block; }
.user-info { flex: 1; min-width: 0; }
.action-row { display: flex; gap: $hh-space-sm; margin-top: $hh-space-xs; }

.feedback-contact-card {
  background: var(--hh-color-card);
  border: 1rpx solid var(--hh-color-line);
  border-radius: var(--hh-radius-card);
  padding: $hh-space-md $hh-space-lg;
  margin-bottom: $hh-space-md;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $hh-space-md;
  box-shadow: var(--hh-shadow-soft);
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
  color: var(--hh-color-text-primary);
}
.feedback-desc {
  font-size: $hh-font-caption;
  color: var(--hh-color-text-tertiary);
  line-height: 1.5;
}
.feedback-contact-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 26rpx;
  height: 60rpx;
  line-height: 60rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
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
  color: var(--hh-color-text-primary);
  display: block;
}
.form-hint {
  font-size: $hh-font-caption;
  color: var(--hh-color-text-tertiary);
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
  background: var(--hh-color-brand-primary);
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
  background: var(--hh-color-card);
  color: var(--hh-color-brand-strong);
  border: 2rpx solid var(--hh-color-brand-line);
  box-shadow: var(--hh-shadow-soft);
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
  color: var(--hh-color-brand-primary);
  text-decoration: underline;
}
.form-actions {
  display: flex;
  gap: $hh-space-sm;
  flex-wrap: wrap;
  margin-top: $hh-space-xs;
}
.form-actions button { flex: 1; min-width: 160rpx; }
.primary-btn { background: var(--hh-color-brand-primary); color: #fff; }
.primary-btn[disabled] { opacity: $hh-opacity-disabled; }
.section { background: var(--hh-color-card); border: 1rpx solid var(--hh-color-line); border-radius: var(--hh-radius-card); padding: $hh-space-md $hh-space-lg; margin-bottom: $hh-space-md; box-shadow: var(--hh-shadow-soft); }
.section-title { font-size: var(--hh-text-body-base-size); color: var(--hh-color-text-tertiary); display: block; margin-bottom: $hh-space-md; }
.list-item { display: flex; justify-content: space-between; align-items: center; padding: $hh-space-md 0; border-bottom: 1rpx solid var(--hh-color-line-soft); }
.item-name { font-size: var(--hh-text-body-lg-size); color: var(--hh-color-text-primary); }
.community-actions { display: flex; align-items: center; gap: $hh-space-sm; }
.badges { display: flex; gap: $hh-space-xs; }
.badge { font-size: $hh-font-tag; padding: 4rpx 12rpx; border-radius: $hh-radius-lg; }
.badge.admin { background: #e3f2fd; color: #1565c0; }
.badge.current { background: var(--hh-color-brand-soft); color: var(--hh-color-brand-strong); }
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
.approval-section { border: 1rpx solid rgba(217, 48, 38, 0.12); }
.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $hh-space-sm;
  margin-bottom: $hh-space-md;
}
.section-count {
  font-size: $hh-font-caption;
  color: #d93026;
  background: #fff5f5;
  border-radius: $hh-radius-full;
  padding: 6rpx 14rpx;
}
.approval-group { margin-top: $hh-space-sm; }
.approval-group-title {
  display: block;
  margin: $hh-space-md 0 $hh-space-xs;
  color: $hh-color-text-sub;
  font-size: $hh-font-caption;
  font-weight: $hh-font-weight-bold;
}
.approval-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: $hh-space-md;
  padding: $hh-space-md 0;
  border-bottom: 1rpx solid $hh-color-divider;
}
.approval-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.approval-name {
  color: $hh-color-text;
  font-size: $hh-font-body;
  font-weight: $hh-font-weight-bold;
}
.approval-meta {
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
  line-height: 1.45;
}
.approval-actions { display: flex; flex-shrink: 0; gap: $hh-space-sm; }
.approval-reminder-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $hh-space-md;
  margin-bottom: $hh-space-sm;
  padding: $hh-space-sm $hh-space-md;
  border-radius: $hh-radius-sm;
  background: var(--hh-color-brand-soft);
  border: 1rpx solid var(--hh-color-brand-line);
}
.approval-reminder-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.approval-reminder-title {
  color: $hh-color-text;
  font-size: $hh-font-body;
  font-weight: $hh-font-weight-bold;
}
.approval-reminder-desc {
  color: $hh-color-text-mute;
  font-size: $hh-font-caption;
  line-height: 1.45;
}
.approval-reminder-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 22rpx;
  height: 52rpx;
  line-height: 52rpx;
  border-radius: $hh-radius-full;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: $hh-font-caption;
}
.approval-reminder-btn::after { border: none; }
.hint-text { display: block; margin-top: $hh-space-sm; color: $hh-color-text-sub; font-size: $hh-font-caption; line-height: $hh-line-height-base; }
.hint-text.warn { color: #b7791f; }
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
  background: var(--hh-color-card); border-radius: var(--hh-radius-card);
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
  background: var(--hh-color-card); border-radius: var(--hh-radius-card);
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

.input-wrap { background: var(--hh-color-page); border-radius: $hh-radius-sm; padding: $hh-space-md; }
.input { font-size: var(--hh-text-body-base-size); width: 100%; min-height: 40rpx; background: transparent; color: var(--hh-color-text-primary); }
.input-placeholder { color: var(--hh-color-text-tertiary); font-size: var(--hh-text-body-base-size); }
.dev-login-btn { background: $hh-color-text; color: $hh-color-text-inverse; }
.approve-btn { background: $hh-color-info; color: $hh-color-text-inverse; }

/* Figma 0626 profile pass */
.profile-page {
  padding-top: 42rpx;
  background:
    radial-gradient(circle at 80% 4%, rgba(61, 173, 125, 0.18), transparent 30%),
    linear-gradient(188deg, #cff5f2 0%, #fff 26%, #f2f3f7 58%, var(--hh-color-page) 100%);
}

.user-card {
  margin-top: 12rpx;
  margin-bottom: 24rpx;
  padding: 28rpx 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.avatar {
  width: 128rpx;
  height: 128rpx;
  margin-right: 32rpx;
  background: var(--hh-color-brand-soft);
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.name-row,
.profile-community-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.name {
  min-width: 0;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-admin-badge {
  flex: 0 0 auto;
  padding: 4rpx 12rpx;
  border: 1rpx solid #d27700;
  border-radius: 8rpx;
  background: #fffae8;
  color: #d27700;
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.profile-community-name {
  min-width: 0;
  color: var(--hh-color-text-primary);
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-switch {
  flex: 0 0 auto;
  min-height: 48rpx;
  padding: 0 22rpx;
  border: 2rpx solid var(--hh-color-brand-primary);
  border-radius: $hh-radius-full;
  background: rgba(255, 255, 255, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-switch text {
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
}

.action-row {
  margin-top: 4rpx;
}

.action-row button {
  margin: 0;
  padding: 0;
  height: 42rpx;
  line-height: 42rpx;
  border: 0;
  background: transparent;
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-body-base-size);
}

.action-row button::after {
  border: 0;
}

.profile-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24rpx;
  margin-bottom: 24rpx;
}

.profile-shortcut {
  position: relative;
  min-height: 152rpx;
  overflow: hidden;
  padding: 32rpx;
  border-radius: var(--hh-radius-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-shortcut.create {
  background: #fdf6e6;
}

.profile-shortcut.join {
  background: #e5f8f2;
}

.shortcut-title {
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  font-weight: $hh-font-weight-bold;
}

.profile-shortcut.create .shortcut-title {
  color: #f90;
}

.shortcut-icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-size: 44rpx;
  line-height: 64rpx;
  text-align: center;
  font-weight: $hh-font-weight-bold;
}

.profile-shortcut.create .shortcut-icon {
  background: #ffad3d;
}

.section,
.feedback-contact-card {
  border: 0;
  border-radius: var(--hh-radius-card);
}

/* Figma 4.1 / 4.2 final profile structure */
.profile-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 0 32rpx calc(132rpx + env(safe-area-inset-bottom));
  background:
    radial-gradient(circle at 100% 0%, rgba(61, 173, 125, 0.12), transparent 26%),
    linear-gradient(188.63deg, #cff5f2 4.09%, #fff 22.04%, #fff 35.76%, #f2f3f7 52.32%, #f2f3f7 100%);
}

.profile-custom-nav {
  box-sizing: border-box;
  width: 100%;
  padding-top: env(safe-area-inset-top);
}

.profile-custom-nav-row {
  height: var(--profile-nav-row-height, 54px);
  display: flex;
  align-items: center;
}

.profile-custom-nav-title {
  color: #181818;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  font-weight: $hh-font-weight-bold;
}

.user-card {
  position: relative;
  box-sizing: border-box;
  min-height: 192rpx;
  margin: 0 0 24rpx;
  padding: 32rpx 0 28rpx;
  display: flex;
  align-items: center;
}

.user-card--form {
  min-height: auto;
  margin: 16rpx 0 40rpx;
  padding: 40rpx;
  border-radius: 32rpx;
  background: #fff;
  box-shadow: none;
}

.user-card--form .login-form {
  gap: 32rpx;
}

.user-card--form .form-title {
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
}

.user-card--form .form-hint {
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
}

.user-card--form .avatar-row {
  gap: 16rpx;
  padding: 24rpx 0 8rpx;
}

.user-card--form .avatar-edit-wrap,
.user-card--form .avatar-preview {
  width: 176rpx;
  height: 176rpx;
}

.user-card--form .avatar-edit-badge {
  right: 0;
  bottom: 0;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hh-color-brand-primary);
}

.avatar-edit-camera {
  box-sizing: border-box;
  width: 26rpx;
  height: 20rpx;
  border: 3rpx solid #fff;
  border-radius: 5rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-edit-camera-lens {
  box-sizing: border-box;
  width: 9rpx;
  height: 9rpx;
  border: 2rpx solid #fff;
  border-radius: 999rpx;
}

.user-card--form .avatar-hint {
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.user-card--form .input-wrap {
  box-sizing: border-box;
  min-height: 112rpx;
  padding: 0 24rpx;
  border: 1rpx solid transparent;
  border-radius: 12rpx;
  background: #f6f7f9;
  display: flex;
  align-items: center;
}

.user-card--form .input {
  min-height: 64rpx;
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
}

.user-card--form .form-actions {
  flex-wrap: nowrap;
  gap: 16rpx;
  margin-top: 8rpx;
}

.user-card--form .form-actions button {
  min-width: 0;
  height: 72rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid #d8ddda;
  border-radius: 12rpx;
  background: #fff;
  color: #181818;
  font-size: var(--hh-text-body-lg-size);
  line-height: 72rpx;
}

.user-card--form .form-actions button::after {
  border: 0;
}

.user-card--form .form-actions .primary-btn {
  border-color: var(--hh-color-brand-primary);
  background: var(--hh-color-brand-primary);
  color: #fff;
}

.profile-edit-mask {
  position: fixed;
  inset: 0;
  z-index: $hh-z-modal;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.55);
  overscroll-behavior: contain;
}

.profile-edit-sheet {
  box-sizing: border-box;
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  border-radius: 32rpx 32rpx 0 0;
  padding: 40rpx 40rpx 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
  background: #fff;
  box-shadow: 0 -16rpx 48rpx rgba(31, 35, 32, 0.16);
}

.profile-edit-sheet__title {
  display: block;
  color: #181818;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  font-weight: $hh-font-weight-bold;
  text-align: center;
}

.profile-edit-sheet__avatar-row {
  padding: 40rpx 0 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}

.profile-edit-sheet .avatar-edit-wrap,
.profile-edit-sheet .avatar-preview {
  width: 176rpx;
  height: 176rpx;
}

.profile-edit-sheet .avatar-edit-badge {
  right: 0;
  bottom: 0;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-edit-sheet__capability {
  color: var(--hh-color-text-tertiary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.profile-edit-sheet__field {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.profile-edit-sheet__label {
  color: #292116;
  font-size: var(--hh-text-body-lg-size);
  line-height: var(--hh-text-body-lg-line);
  font-weight: $hh-font-weight-bold;
}

.profile-edit-sheet__input-wrap {
  box-sizing: border-box;
  min-height: 104rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  background: #f6f7f9;
}

.profile-edit-sheet__actions {
  margin-top: 40rpx;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.profile-edit-sheet__actions button {
  height: 88rpx;
  margin: 0;
  padding: 0;
  border-radius: 999rpx;
  font-size: var(--hh-text-body-lg-size);
  line-height: 88rpx;
}

.profile-edit-sheet__actions button::after {
  border: 0;
}

.profile-edit-sheet__cancel {
  background: #f2f3f7;
  color: #292116;
}

.profile-edit-sheet__save {
  background: var(--hh-color-brand-primary);
  color: #fff;
}

.profile-edit-sheet__save[disabled] {
  opacity: $hh-opacity-disabled;
}

.avatar {
  width: 128rpx;
  height: 128rpx;
  flex: 0 0 128rpx;
  margin-right: 32rpx;
  border-radius: 9999rpx;
  object-fit: cover;
  background: #f7efe8;
}

.user-info {
  flex: 1;
  min-width: 0;
  gap: 8rpx;
}

.name {
  max-width: 216rpx;
  font-size: var(--hh-text-heading-lg-size);
  line-height: var(--hh-text-heading-lg-line);
  color: #292116;
}

.profile-community-name {
  max-width: 164rpx;
  font-size: var(--hh-text-heading-sm-size);
  line-height: var(--hh-text-heading-sm-line);
  color: #292116;
}

.profile-switch {
  min-height: 52rpx;
  padding: 0 24rpx;
  gap: 8rpx;
  border-width: 2rpx;
  background: #fff;
}

.profile-switch-icon {
  width: 32rpx;
  height: 32rpx;
  display: block;
}

.profile-edit-link {
  position: absolute;
  right: 0;
  top: 92rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: var(--hh-color-brand-primary);
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
}

.profile-edit-arrow {
  width: 36rpx;
  height: 36rpx;
  display: block;
}

.profile-login-hit {
  position: absolute;
  inset: 0;
  z-index: 2;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: transparent;
  opacity: 0;
}

.profile-login-hit::after,
.profile-tool::after,
.profile-primary-action::after,
.profile-secondary-action::after {
  border: 0;
}

.profile-shortcuts {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24rpx;
  margin-bottom: 40rpx;
}

.profile-shortcut {
  min-height: 152rpx;
  box-sizing: border-box;
  padding: 0 32rpx;
  border-radius: 24rpx;
}

.shortcut-title {
  position: relative;
  z-index: 2;
  font-size: var(--hh-text-heading-sm-size);
  line-height: 36rpx;
}

.profile-shortcut-decoration {
  position: absolute;
  z-index: 1;
  top: -22rpx;
  right: -47rpx;
  width: 200rpx;
  height: 200rpx;
  pointer-events: none;
}

.shortcut-icon {
  position: relative;
  z-index: 2;
  width: 80rpx;
  height: 80rpx;
  border-radius: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
}

.profile-shortcut.create .shortcut-icon {
  background: transparent;
}

.shortcut-icon--create .shortcut-icon-image {
  width: 67rpx;
  height: 69rpx;
  display: block;
}

.shortcut-icon--join .shortcut-icon-image {
  position: absolute;
  display: block;
}

.shortcut-icon-image--join-front {
  z-index: 1;
  left: 40.74%;
  top: 36.1%;
  width: 43.99%;
  height: 48.63%;
}

.shortcut-icon-image--join-back {
  z-index: 2;
  left: 15.28%;
  top: 15.28%;
  width: 62.5%;
  height: 69.45%;
}

.shortcut-icon-image--join-pin {
  z-index: 3;
  left: 26.76%;
  top: 27.33%;
  width: 39.54%;
  height: 43.41%;
}

.profile-tools-card {
  box-sizing: border-box;
  margin-bottom: 40rpx;
  padding: 32rpx 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  row-gap: 28rpx;
  border-radius: 24rpx;
  background: #fff;
}

.profile-tool {
  min-width: 0;
  min-height: 132rpx;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  line-height: 1;
}

.profile-tool-icon {
  width: 80rpx;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-tool-icon-image {
  width: 60rpx;
  height: 60rpx;
  display: block;
}

.profile-tool-icon-image--heart { width: 60rpx; height: 54rpx; }
.profile-tool-icon-image--like { width: 58rpx; height: 58rpx; }
.profile-tool-icon-image--archive { width: 55rpx; height: 50rpx; }
.profile-tool-icon-image--activity { width: 55rpx; height: 55rpx; }
.profile-tool-icon-image--post { width: 51rpx; height: 56rpx; }
.profile-tool-icon-image--checkin { width: 50rpx; height: 55rpx; }
.profile-tool-icon-image--service { width: 56rpx; height: 56rpx; }

.profile-tool-label {
  color: #292116;
  font-size: var(--hh-text-body-base-size);
  line-height: var(--hh-text-body-base-line);
  white-space: nowrap;
}

.profile-primary-action,
.profile-secondary-action {
  width: 100%;
  height: 96rpx;
  margin: 0 0 24rpx;
  padding: 0;
  border-radius: 999rpx;
  font-size: var(--hh-text-heading-sm-size);
  line-height: 96rpx;
  text-align: center;
}

.profile-primary-action {
  background: var(--hh-color-brand-primary);
  color: #fff;
  font-weight: $hh-font-weight-bold;
}

.profile-secondary-action {
  background: #fff;
  color: #181818;
}

.profile-secondary-action[disabled] {
  opacity: 0.58;
}

.approval-section {
  margin-top: 8rpx;
}
</style>
