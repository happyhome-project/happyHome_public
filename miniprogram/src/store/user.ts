import { defineStore } from 'pinia'
import { userApi } from '../api/cloud'
import { useCommunityStore } from './community'

const STORAGE_KEY = 'user_store'

// uni-app exposes uni.getStorageSync in both H5 and miniprogram — safer than wx.*
function storageGet(k: string): any {
  try { return uni.getStorageSync(k) } catch (_error) { return null }
}
function storageSet(k: string, v: any): void {
  try { uni.setStorageSync(k, v) } catch (_error) {}
}
function storageRemove(k: string): void {
  try { uni.removeStorageSync(k) } catch (_error) {}
}

function isWebRuntime(): boolean {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore wx is injected by the mini-program runtime.
  return typeof wx === 'undefined' || !wx?.cloud?.callFunction
}

function loadWebAuth() {
  return import('../api/web-cloudbase')
}

function errorMessage(error: any): string {
  return String(error?.message || error || 'unknown error')
}

export const useUserStore = defineStore('user', {
  state: () => ({
    openId: '' as string,
    nickName: '' as string,
    avatarUrl: '' as string,
    role: 'user' as 'user' | 'superAdmin',
    isLoggedIn: false,
    backgroundFetchToken: '' as string,
    backgroundFetchTokenExpiresAt: '' as string,
  }),
  actions: {
    clearLocalSession() {
      this.openId = ''
      this.nickName = ''
      this.avatarUrl = ''
      this.role = 'user'
      this.isLoggedIn = false
      this.backgroundFetchToken = ''
      this.backgroundFetchTokenExpiresAt = ''
      storageRemove(STORAGE_KEY)
      this.clearBackgroundFetchToken()
      storageRemove('dev-gateway')
      storageRemove('test-openid')
      try {
        const cs = useCommunityStore()
        cs.clearCommunityState()
        cs.myCommunities = []
        cs.membershipByCommunity = {}
      } catch (_error) {}
    },
    loadFromStorage() {
      const saved = storageGet(STORAGE_KEY)
      if (saved) Object.assign(this, saved)
    },
    saveToStorage() {
      storageSet(STORAGE_KEY, {
        openId: this.openId,
        nickName: this.nickName,
        avatarUrl: this.avatarUrl,
        role: this.role,
        isLoggedIn: this.isLoggedIn,
        backgroundFetchToken: this.backgroundFetchToken,
        backgroundFetchTokenExpiresAt: this.backgroundFetchTokenExpiresAt,
      })
    },
    syncBackgroundFetchToken() {
      const token = String(this.backgroundFetchToken || '').trim()
      if (!token) return
      this.applyBackgroundFetchToken(token)
    },
    applyBackgroundFetchToken(token: string) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore wx is injected by the mini-program runtime.
        const wxRef: any = typeof wx !== 'undefined' ? wx : null
        if (!wxRef?.setBackgroundFetchToken) return
        wxRef.setBackgroundFetchToken({
          token,
          fail: (error: any) => console.warn('[background-fetch-token] set failed', error),
        })
      } catch (error) {
        console.warn('[background-fetch-token] set threw', error)
      }
    },
    clearBackgroundFetchToken() {
      this.applyBackgroundFetchToken('')
    },
    setBackgroundFetchToken(token?: string, expiresAt?: string) {
      this.backgroundFetchToken = String(token || '')
      this.backgroundFetchTokenExpiresAt = String(expiresAt || '')
      this.saveToStorage()
      this.syncBackgroundFetchToken()
    },
    /**
     * 微信登录（新方案，2022-10 后策略变更）。
     *
     * 由于 wx.getUserProfile 在真机上会强制返回 "微信用户" + 默认头像，官方唯一
     * 合规的方案是让用户通过 <button open-type="chooseAvatar"> + <input type="nickname">
     * 主动采集。由 profile 页的表单采集后把 { nickName, avatarUrl } 传给这个方法。
     *
     * avatarUrl 可以是：
     *  - cloud:// ...（已上传到 COS 的永久路径，推荐）
     *  - 空串（后端/前端自己用默认灰头像兜底）
     *  - 临时路径 wxfile:// / http://tmp/...（不推荐，会失效，应先上传 COS 再传入）
     *
     * 这个方法也用于"编辑资料"（user.login 云函数是 upsert 语义），登录态下再调
     * 一次会覆盖 nickName + avatarUrl。
     */
    async login({ nickName, avatarUrl }: { nickName: string; avatarUrl: string }) {
      const name = (nickName || '').trim()
      if (!name) throw new Error('请填写昵称')
      const result = await userApi.login({ nickName: name, avatarUrl: avatarUrl || '' })
      this.openId = result.user._id
      this.nickName = name
      this.avatarUrl = avatarUrl || ''
      this.role = result.user.role
      this.isLoggedIn = true
      this.backgroundFetchToken = result.user.backgroundFetchToken || ''
      this.backgroundFetchTokenExpiresAt = result.user.backgroundFetchTokenExpiresAt || ''
      this.saveToStorage()
      this.syncBackgroundFetchToken()
    },
    async webLogin({ username, password, nickName }: { username: string; password: string; nickName: string }) {
      const name = String(nickName || '').trim()
      if (!name) throw new Error('请填写昵称')
      this.clearLocalSession()
      const webAuth = await loadWebAuth()
      try {
        await webAuth.signIn({ username: String(username || '').trim(), password })
        const result = await userApi.login({ nickName: name, avatarUrl: '' })
        this.openId = result.user._id
        this.nickName = result.user.nickName || name
        this.avatarUrl = result.user.avatarUrl || ''
        this.role = result.user.role
        this.isLoggedIn = true
        this.backgroundFetchToken = result.user.backgroundFetchToken || ''
        this.backgroundFetchTokenExpiresAt = result.user.backgroundFetchTokenExpiresAt || ''
        this.saveToStorage()
        this.syncBackgroundFetchToken()
      } catch (error) {
        let rollbackError: any = null
        try { await webAuth.signOut() } catch (signOutError) { rollbackError = signOutError }
        this.clearLocalSession()
        if (rollbackError) {
          const combined = new Error(`${errorMessage(error)}; Web signOut rollback failed: ${errorMessage(rollbackError)}`)
          ;(combined as any).cause = error
          ;(combined as any).rollbackError = rollbackError
          throw combined
        }
        throw error
      }
    },
    async restoreWebSession() {
      const savedNickName = String(this.nickName || '').trim()
      try {
        const webAuth = await loadWebAuth()
        const session = await webAuth.getLoginState()
        if (!session) {
          this.clearLocalSession()
          return false
        }
        if (!savedNickName) {
          try {
            await webAuth.signOut()
          } finally {
            this.clearLocalSession()
          }
          return false
        }
        const result = await userApi.login({ nickName: savedNickName, avatarUrl: this.avatarUrl || '' })
        this.openId = result.user._id
        this.nickName = result.user.nickName || savedNickName
        this.avatarUrl = result.user.avatarUrl || this.avatarUrl || ''
        this.role = result.user.role
        this.isLoggedIn = true
        this.backgroundFetchToken = result.user.backgroundFetchToken || ''
        this.backgroundFetchTokenExpiresAt = result.user.backgroundFetchTokenExpiresAt || ''
        this.saveToStorage()
        this.syncBackgroundFetchToken()
        await useCommunityStore().loadMyCommunities({ loadSections: false })
        return true
      } catch (error) {
        this.clearLocalSession()
        throw error
      }
    },
    async refreshLoginRole() {
      if (!this.isLoggedIn) return
      const name = (this.nickName || '').trim()
      if (!name) return
      const result = await userApi.login({ nickName: name, avatarUrl: this.avatarUrl || '' })
      this.openId = result.user._id
      this.nickName = result.user.nickName || name
      this.avatarUrl = result.user.avatarUrl || this.avatarUrl || ''
      this.role = result.user.role
      this.isLoggedIn = true
      this.backgroundFetchToken = result.user.backgroundFetchToken || this.backgroundFetchToken || ''
      this.backgroundFetchTokenExpiresAt = result.user.backgroundFetchTokenExpiresAt || this.backgroundFetchTokenExpiresAt || ''
      this.saveToStorage()
      this.syncBackgroundFetchToken()
    },
    /**
     * DEV 模式登录：绕过 wx.login，直接用指定 openid 通过 http-gateway 调
     * user.login 云函数。用于测试环境 / H5 / 无法真机微信登录的场景。
     *
     * 副作用：
     *   - localStorage 'dev-gateway' = '1' → 后续所有 callCloud 都走 gateway
     *   - localStorage 'test-openid' = <openid> → gateway 用它注入 OPENID
     */
    async devLogin(openid: string, nickName: string) {
      const id = (openid || '').trim() || `dev-${Date.now().toString(36)}`
      const nn = (nickName || '').trim() || 'DEV 用户'
      // Enable gateway mode before calling any API
      storageSet('dev-gateway', '1')
      storageSet('test-openid', id)
      const result = await userApi.login({ nickName: nn, avatarUrl: '' })
      this.openId = result.user._id
      this.nickName = nn
      this.avatarUrl = ''
      this.role = result.user.role
      this.isLoggedIn = true
      this.backgroundFetchToken = result.user.backgroundFetchToken || ''
      this.backgroundFetchTokenExpiresAt = result.user.backgroundFetchTokenExpiresAt || ''
      this.saveToStorage()
      this.syncBackgroundFetchToken()
    },
    async logout() {
      try {
        if (isWebRuntime()) {
          const webAuth = await loadWebAuth()
          await webAuth.signOut()
        }
      } finally {
        this.clearLocalSession()
      }
    },
  },
})
