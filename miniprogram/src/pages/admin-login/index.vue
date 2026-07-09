<template>
  <view class="admin-login-page">
    <view class="card">
      <text class="title">登录 HappyHome 管理后台</text>

      <view v-if="!ticket" class="state error">
        <text class="msg">缺少 scene 参数，请重新扫码</text>
      </view>

      <view v-else-if="!userStore.isLoggedIn" class="state warn">
        <text class="msg">请先在「我的」页面登录小程序后再扫码</text>
        <button class="btn primary" @tap="goLogin">去登录</button>
      </view>

      <view v-else-if="state === 'idle'" class="state">
        <view class="profile">
          <image v-if="userStore.avatarUrl" :src="userStore.avatarUrl" class="avatar" />
          <view v-else class="avatar avatar-fallback">
            <text class="avatar-letter">{{ (userStore.nickName || '微').charAt(0) }}</text>
          </view>
          <text class="nickname">{{ userStore.nickName || '微信用户' }}</text>
        </view>
        <text class="hint">即将以本微信身份登录管理后台，请确认是您本人扫码</text>
        <button class="btn primary" :disabled="submitting" @tap="confirm">
          {{ submitting ? '处理中...' : '确认登录' }}
        </button>
        <button class="btn ghost" :disabled="submitting" @tap="cancel">取消</button>
      </view>

      <view v-else-if="state === 'success'" class="state success">
        <text class="check">✓</text>
        <text class="msg">已登录管理后台，可以关闭本页</text>
      </view>

      <view v-else-if="state === 'no_account'" class="state error">
        <text class="msg">该微信未绑定管理员账号</text>
        <text class="sub">请联系超管在 admin-web 给您开通账号后重试</text>
      </view>

      <view v-else-if="state === 'error'" class="state error">
        <text class="msg">{{ errorMsg || '登录失败，请重试' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useUserStore } from '../../store/user'
import { ensureHierarchyStack, navigateBackOrHome } from '../../utils/hierarchy-nav'

const userStore = useUserStore()
const ticket = ref('')
const state = ref<'idle' | 'success' | 'no_account' | 'error'>('idle')
const submitting = ref(false)
const errorMsg = ref('')

onLoad((options: any) => {
  if (ensureHierarchyStack('/pages/admin-login/index', options || {}, '/pages/profile/index')) return
  // 来源 1：无限带参小程序码 → wechat 注入 options.scene
  // 来源 2：开发期 / 调试 → ?ticket=xxx 直传
  ticket.value = decodeURIComponent(options?.scene || options?.ticket || '')
  userStore.loadFromStorage()
})

async function confirm() {
  if (submitting.value) return
  submitting.value = true
  try {
    // 必须走 wx.cloud.callFunction（不走 callCloud），保证云函数能拿到 OPENID。
    // callCloud 在 dev-gateway 模式下会改走 HTTP，那时 OPENID 为空。
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — wx is injected by mp-weixin runtime
    const wxRef: any = typeof wx !== 'undefined' ? wx : null
    if (!wxRef?.cloud?.callFunction) {
      state.value = 'error'
      errorMsg.value = '当前环境不支持微信扫码登录，请用真机微信打开'
      return
    }
    const res: any = await new Promise((resolve, reject) => {
      wxRef.cloud.callFunction({
        name: 'admin',
        data: { action: 'auth.wxLoginConfirm', ticket: ticket.value },
        success: (r: any) => resolve(r.result),
        fail: reject,
      })
    })
    if (res?.success) {
      state.value = 'success'
    } else if (res?.reason === 'no_account') {
      state.value = 'no_account'
    } else {
      state.value = 'error'
      errorMsg.value = String(res?.message || '登录失败')
    }
  } catch (err: any) {
    state.value = 'error'
    errorMsg.value = String(err?.errMsg || err?.message || '登录失败')
  } finally {
    submitting.value = false
  }
}

function cancel() {
  navigateBackOrHome()
}

function goLogin() {
  uni.switchTab({ url: '/pages/profile/index' })
}
</script>

<style lang="scss" scoped>
.admin-login-page {
  min-height: 100vh;
  background: $hh-color-bg;
  padding: $hh-space-lg;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  background: $hh-surface-1;
  border-radius: $hh-radius-lg;
  padding: $hh-space-xl;
  width: 100%;
  max-width: 600rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}
.title {
  display: block;
  font-size: $hh-font-h2;
  color: $hh-color-text;
  text-align: center;
  margin-bottom: $hh-space-lg;
  font-family: $hh-font-serif;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.profile {
  display: flex;
  align-items: center;
  gap: $hh-space-sm;
  justify-content: center;
  margin-bottom: $hh-space-md;
}
.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
}
.avatar-fallback {
  background: $hh-accent-wash;
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-letter {
  color: $hh-accent-ink;
  font-size: $hh-font-body-lg;
  font-weight: 600;
}
.nickname {
  font-size: $hh-font-body-lg;
  color: $hh-color-text;
}
.hint {
  display: block;
  text-align: center;
  color: $hh-color-text-mute;
  margin: $hh-space-md 0;
  line-height: 1.6;
}
.msg {
  display: block;
  text-align: center;
  color: $hh-color-text;
  margin: $hh-space-md 0;
  line-height: 1.6;
}
.sub {
  display: block;
  font-size: $hh-font-caption;
  color: $hh-color-text-mute;
  text-align: center;
  margin-top: $hh-space-xs;
  line-height: 1.6;
}
.btn {
  width: 100%;
  margin: $hh-space-sm 0;
}
.btn.primary {
  background: $hh-accent;
  color: #fff;
}
.btn.ghost {
  background: transparent;
  color: $hh-color-text-mute;
}
.state.success .check {
  display: block;
  text-align: center;
  color: $hh-accent;
  font-size: 96rpx;
  margin-bottom: $hh-space-sm;
}
.state.error .msg {
  color: $hh-live;
}
</style>
