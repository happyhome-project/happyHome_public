import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../api/cloud'

type AdminRole = 'superAdmin' | 'communityAdmin'

const LS_TOKEN = 'token'
const LS_ROLE = 'admin_role'
const LS_USER_ID = 'admin_userId'
const LS_USERNAME = 'admin_username'

function readRole(): AdminRole | '' {
  const v = localStorage.getItem(LS_ROLE)
  return v === 'superAdmin' || v === 'communityAdmin' ? v : ''
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem(LS_TOKEN) || '')
  const role = ref<AdminRole | ''>(readRole())
  const userId = ref<string>(localStorage.getItem(LS_USER_ID) || '')
  const username = ref<string>(localStorage.getItem(LS_USERNAME) || '')

  const isAuthenticated = computed(() => !!token.value && !!role.value)
  const isSuperAdmin = computed(() => role.value === 'superAdmin')
  const isCommunityAdmin = computed(() => role.value === 'communityAdmin')

  function persist() {
    if (token.value) localStorage.setItem(LS_TOKEN, token.value)
    else localStorage.removeItem(LS_TOKEN)
    if (role.value) localStorage.setItem(LS_ROLE, role.value)
    else localStorage.removeItem(LS_ROLE)
    if (userId.value) localStorage.setItem(LS_USER_ID, userId.value)
    else localStorage.removeItem(LS_USER_ID)
    if (username.value) localStorage.setItem(LS_USERNAME, username.value)
    else localStorage.removeItem(LS_USERNAME)
  }

  function clear() {
    token.value = ''
    role.value = ''
    userId.value = ''
    username.value = ''
    persist()
  }

  async function login(u: string, p: string) {
    const res = await authApi.login(u, p)
    token.value = res.token
    role.value = res.role
    userId.value = res.userId || ''
    username.value = res.username || u
    persist()
    return res
  }

  // 用扫码登录拿到的 session 直接写 store（绕过 username/password 路径）
  function setSession(payload: { token: string; role: AdminRole; userId?: string; username?: string }) {
    token.value = payload.token
    role.value = payload.role
    userId.value = payload.userId || ''
    username.value = payload.username || ''
    persist()
  }

  async function logout() {
    try {
      if (token.value) await authApi.logout()
    } catch { /* best effort */ }
    clear()
  }

  async function fetchMe() {
    if (!token.value) return null
    try {
      const res = await authApi.me()
      role.value = res.role
      userId.value = res.userId || ''
      username.value = res.username || ''
      persist()
      return res
    } catch {
      clear()
      return null
    }
  }

  return {
    token, role, userId, username,
    isAuthenticated, isSuperAdmin, isCommunityAdmin,
    login, logout, fetchMe, clear, setSession,
  }
})
