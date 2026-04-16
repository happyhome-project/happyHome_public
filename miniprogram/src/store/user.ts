import { defineStore } from 'pinia'
import { userApi } from '../api/cloud'

const STORAGE_KEY = 'user_store'

// uni-app exposes uni.getStorageSync in both H5 and miniprogram — safer than wx.*
function storageGet(k: string): any {
  try { return uni.getStorageSync(k) } catch { return null }
}
function storageSet(k: string, v: any): void {
  try { uni.setStorageSync(k, v) } catch {}
}
function storageRemove(k: string): void {
  try { uni.removeStorageSync(k) } catch {}
}

export const useUserStore = defineStore('user', {
  state: () => ({
    openId: '' as string,
    nickName: '' as string,
    avatarUrl: '' as string,
    role: 'user' as 'user' | 'superAdmin',
    isLoggedIn: false,
  }),
  actions: {
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
      })
    },
    async login() {
      // Real WeChat login path — uses wx.getUserProfile + wx.login (implicit via cloud)
      return new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (typeof wx === 'undefined' || !wx.getUserProfile) {
          reject(new Error('当前环境不支持微信登录，请使用 DEV 模式登录'))
          return
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        wx.getUserProfile({
          desc: '用于展示用户头像和昵称',
          success: async (profileRes: any) => {
            try {
              const { nickName, avatarUrl } = profileRes.userInfo
              const result = await userApi.login({ nickName, avatarUrl })
              this.openId = result.user._id
              this.nickName = nickName
              this.avatarUrl = avatarUrl
              this.role = result.user.role
              this.isLoggedIn = true
              this.saveToStorage()
              resolve()
            } catch (err) { reject(err) }
          },
          fail: reject,
        })
      })
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
      this.saveToStorage()
    },
    logout() {
      this.openId = ''
      this.nickName = ''
      this.avatarUrl = ''
      this.role = 'user'
      this.isLoggedIn = false
      storageRemove(STORAGE_KEY)
      // Also clear DEV mode flags so next login path is clean
      storageRemove('dev-gateway')
      storageRemove('test-openid')
    },
  },
})
