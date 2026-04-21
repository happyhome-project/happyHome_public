<template>
  <div class="login-page" data-testid="login-page">
    <div class="login-box" data-testid="login-box">
      <h2>HappyHome 管理后台</h2>
      <el-form data-testid="login-form" @submit.prevent="handleLogin">
        <el-form-item>
          <div data-testid="login-username-field">
            <el-input v-model="username" placeholder="用户名" />
          </div>
        </el-form-item>
        <el-form-item>
          <div data-testid="login-password-field">
            <el-input v-model="password" type="password" placeholder="密码" show-password />
          </div>
        </el-form-item>
        <el-button data-testid="login-submit" type="primary" native-type="submit" :loading="loading" style="width: 100%;">
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)

const ADMIN_USERNAME = import.meta.env.VITE_ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'happyhome2024'
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || 'happyhome-admin-2024'

function handleLogin() {
  loading.value = true
  setTimeout(() => {
    if (username.value === ADMIN_USERNAME && password.value === ADMIN_PASSWORD) {
      localStorage.setItem('token', ADMIN_TOKEN)
      router.push('/')
    } else {
      ElMessage.error('用户名或密码错误')
    }
    loading.value = false
  }, 300)
}
</script>

<style scoped>
.login-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f0f2f5; }
.login-box { background: #fff; padding: 40px; border-radius: 8px; width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
h2 { text-align: center; margin-bottom: 32px; color: #333; }
</style>
