import { defineStore } from 'pinia'
import { userApi } from '../api/cloud'

export const useUserStore = defineStore('user', {
  state: () => ({
    openId: '' as string,
    nickName: '' as string,
    avatarUrl: '' as string,
    role: 'user' as 'user' | 'superAdmin',
    isLoggedIn: false,
  }),
  actions: {
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
              resolve()
            } catch (err) { reject(err) }
          },
          fail: reject,
        })
      })
    },
  },
})
