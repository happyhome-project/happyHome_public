<template>
  <div class="login-page" data-testid="login-page">
    <div class="login-box" data-testid="login-box">
      <h2>HappyHome 管理后台</h2>
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
      <el-button
        data-testid="login-wx-scan"
        style="width: 100%;"
        disabled
        title="扫码登录即将支持"
      >
        微信扫码登录（即将支持）
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()
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
