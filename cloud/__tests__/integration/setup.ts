// 集成测试公共 setup
// 提供切换用户身份的辅助函数
// jest.mock('wx-server-sdk') 必须在各测试文件中直接调用（Jest 只 hoist 测试文件中的 mock）

let currentOpenId = 'user-default'

export function _getOpenId() {
  return currentOpenId
}

/** 切换当前用户身份（模拟不同微信用户调用） */
export function setCurrentUser(openId: string) {
  currentOpenId = openId
}

/** 重置为默认用户 */
export function resetCurrentUser() {
  currentOpenId = 'user-default'
}
