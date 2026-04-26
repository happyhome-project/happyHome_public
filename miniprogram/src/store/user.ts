import { defineStore } from 'pinia'
import { userApi } from '../api/cloud'
import { useCommunityStore } from './community'

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
      this.saveToStorage()
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
      // 连带清掉社区 store —— 否则登出后其他页面可能读到旧的
      // currentCommunityId / myCommunities 而继续对后端发请求
      try {
        const cs = useCommunityStore()
        cs.clearCommunityState()
        cs.myCommunities = []
        cs.membershipByCommunity = {}
      } catch {
        /* Pinia root 还未初始化时 useCommunityStore() 会 throw，
         * 这种情况下本来就没数据需要清，直接忽略 */
      }
    },
  },
})
