// L3 云端验收测试配置
// 通过 HTTP 调用部署在 CloudBase 上的真实云函数
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/cloud/**/*.cloud.test.ts'],
}
