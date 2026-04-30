<template>
  <div class="login-page" data-testid="login-page">
    <div class="login-box" data-testid="login-box">
      <h2>HappyHome 管理后台</h2>

      <!-- 扫码模式 -->
      <template v-if="mode === 'qr'">
        <div class="qr-area" data-testid="login-qr-area">
          <div v-if="qrState === 'loading'" class="qr-state">
            <el-icon class="is-loading" :size="32"><Loading /></el-icon>
            <p class="qr-hint">生成二维码中...</p>
          </div>

          <div v-else-if="qrState === 'pending'" class="qr-state">
            <img :src="qrCodeBase64" alt="微信扫码登录" class="qr-img" data-testid="login-qr-img" />
            <p class="qr-hint">用微信扫码 → 在小程序里点「确认登录」</p>
            <p class="qr-sub">{{ countdownText }}</p>
          </div>

          <div v-else-if="qrState === 'success'" class="qr-state success">
            <el-icon :size="48" color="#3A6A45"><Select /></el-icon>
            <p class="qr-hint">扫码成功，正在跳转...</p>
          </div>

          <div v-else-if="qrState === 'no_account'" class="qr-state error">
            <el-icon :size="40" color="#CF4040"><CircleClose /></el-icon>
            <p class="qr-hint">该微信未绑定管理员账号</p>
            <p class="qr-sub">微信扫码登录尚未开发完毕，请先使用账号密码登录。</p>
            <el-button @click="restart" type="primary" plain>重新生成二维码</el-button>
          </div>

          <div v-else-if="qrState === 'expired' || qrState === 'denied'" class="qr-state error">
            <el-icon :size="40" color="#CF4040"><Warning /></el-icon>
            <p class="qr-hint">二维码已过期</p>
            <el-button @click="restart" type="primary" plain>刷新</el-button>
          </div>

          <div v-else-if="qrState === 'error'" class="qr-state error">
            <el-icon :size="40" color="#CF4040"><Warning /></el-icon>
            <p class="qr-hint">{{ errorMsg || '生成二维码失败' }}</p>
            <el-button @click="restart" type="primary" plain>重试</el-button>
          </div>
        </div>

        <el-divider>或</el-divider>
        <el-button data-testid="login-switch-password" link @click="mode = 'password'">
          使用账号密码登录
        </el-button>
      </template>

      <!-- 密码模式 -->
      <template v-else>
        <el-form class="login-form" data-testid="login-form" @submit.prevent="handleLogin">
          <el-form-item>
            <div class="login-field" data-testid="login-username-field">
              <el-input class="login-input" v-model="username" placeholder="用户名" />
            </div>
          </el-form-item>
          <el-form-item>
            <div class="login-field" data-testid="login-password-field">
              <el-input class="login-input" v-model="password" type="password" placeholder="密码" show-password />
            </div>
          </el-form-item>
          <el-button class="login-submit" data-testid="login-submit" type="primary" native-type="submit" :loading="loading">
            登录
          </el-button>
        </el-form>

        <el-divider>或</el-divider>
        <el-button data-testid="login-switch-qr" link @click="switchToQr">
          微信扫码登录（未开发完毕）
        </el-button>
        <p class="qr-sub qr-beta-hint">当前请优先使用账号密码登录；扫码能力仅作为后续辅助入口保留。</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading, Select, CircleClose, Warning } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { authApi, type WxLoginStatus } from '../api/cloud'

const router = useRouter()
const authStore = useAuthStore()

// 账号密码是当前稳定主入口；扫码登录仍在打磨中，仅作为辅助入口保留。
const mode = ref<'qr' | 'password'>('password')

// ─── 密码登录 ───
const username = ref('')
const password = ref('')
const loading = ref(false)

async function handleLogin() {
  if (loading.value) return
  loading.value = true
  try {
    const res = await authStore.login(username.value.trim(), password.value)
    ElMessage.success('登录成功')
    const redirect = res.role === 'superAdmin' ? '/approval' : '/communities'
    router.push(redirect)
  } catch (err: any) {
    const msg = err?.response?.data?.error || err?.message || '登录失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

// ─── 扫码登录 ───
type QrState = 'loading' | 'pending' | WxLoginStatus | 'error'
const qrState = ref<QrState>('loading')
const ticket = ref('')
const qrCodeBase64 = ref('')
const expiresAt = ref('')
const errorMsg = ref('')
const now = ref(Date.now())
let pollTimer: ReturnType<typeof setInterval> | undefined
let countdownTimer: ReturnType<typeof setInterval> | undefined

const countdownText = computed(() => {
  if (!expiresAt.value) return ''
  const remain = Math.max(0, Math.floor((Date.parse(expiresAt.value) - now.value) / 1000))
  if (remain <= 0) return '已过期'
  const m = Math.floor(remain / 60)
  const s = remain % 60
  return `剩余 ${m}:${String(s).padStart(2, '0')} 内有效`
})

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = undefined }
}

async function startScanMode() {
  stopPoll()
  qrState.value = 'loading'
  errorMsg.value = ''
  try {
    const res = await authApi.wxLoginStart()
    ticket.value = res.ticket
    qrCodeBase64.value = res.qrCodeBase64
    expiresAt.value = res.expiresAt
    qrState.value = 'pending'
    now.value = Date.now()
    countdownTimer = setInterval(() => { now.value = Date.now() }, 1000)
    pollTimer = setInterval(poll, 2000)
  } catch (err: any) {
    qrState.value = 'error'
    errorMsg.value = err?.response?.data?.error || err?.message || '生成二维码失败'
  }
}

async function poll() {
  if (Date.now() > Date.parse(expiresAt.value)) {
    stopPoll()
    qrState.value = 'expired'
    return
  }
  try {
    const res = await authApi.wxLoginPoll(ticket.value)
    if (res.status === 'success' && res.token && res.role) {
      stopPoll()
      qrState.value = 'success'
      authStore.setSession({
        token: res.token,
        role: res.role,
        userId: res.userId,
        username: res.username,
      })
      ElMessage.success('扫码登录成功')
      const redirect = res.role === 'superAdmin' ? '/approval' : '/communities'
      // 留 0.4 秒展示成功状态再跳
      setTimeout(() => router.push(redirect), 400)
    } else if (res.status === 'no_account') {
      stopPoll()
      qrState.value = 'no_account'
    } else if (res.status === 'expired' || res.status === 'denied') {
      stopPoll()
      qrState.value = res.status
    }
    // 'pending' 时继续轮询
  } catch {
    // 网络抖动忽略，下次再试
  }
}

function restart() {
  startScanMode()
}

function switchToQr() {
  mode.value = 'qr'
  startScanMode()
}

onMounted(() => {
  if (mode.value === 'qr') startScanMode()
})

onUnmounted(stopPoll)
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: #f0f2f5;
}

.login-box {
  width: min(440px, 100%);
  padding: 48px 40px 40px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(31, 45, 61, 0.10);
}

h2 {
  margin: 0 0 28px;
  color: #303133;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
  text-align: center;
}

.qr-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 320px;
  justify-content: center;
}

.qr-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.qr-img {
  width: 240px;
  height: 240px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fff;
}

.qr-hint {
  margin: 0;
  text-align: center;
  color: #303133;
  font-size: 14px;
}

.qr-sub {
  margin: 0;
  text-align: center;
  color: #909399;
  font-size: 12px;
}

.qr-beta-hint {
  margin-top: 8px;
  line-height: 1.5;
}

.qr-state.error .qr-hint {
  color: #f56c6c;
}

.login-form {
  width: 100%;
}

.login-form :deep(.el-form-item__content) {
  display: block;
  width: 100%;
}

.login-field {
  width: 100%;
}

.login-input,
.login-input :deep(.el-input__wrapper) {
  width: 100%;
}

.login-input :deep(.el-input__wrapper) {
  min-height: 40px;
}

.login-submit {
  width: 100%;
  height: 40px;
  margin-top: 2px;
}
</style>
