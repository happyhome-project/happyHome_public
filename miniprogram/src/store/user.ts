import { defineStore } from 'pinia'
import { userApi } from '../api/cloud'

const STORAGE_KEY = 'user_store'

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
      try {
        const saved = wx.getStorageSync(STORAGE_KEY)
        if (saved) Object.assign(this, saved)
      } catch {}
    },
    saveToStorage() {
      try {
        wx.setStorageSync(STORAGE_KEY, {
          openId: this.openId,
          nickName: this.nickName,
          avatarUrl: this.avatarUrl,
          role: this.role,
          isLoggedIn: this.isLoggedIn,
        })
      } catch {}
    },
    async login() {
      return new Promise<void>((resolve, reject) => {
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
    logout() {
      this.openId = ''
      this.nickName = ''
      this.avatarUrl = ''
      this.role = 'user'
      this.isLoggedIn = false
      try { wx.removeStorageSync(STORAGE_KEY) } catch {}
    },
  },
})
