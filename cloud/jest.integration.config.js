// L2 本地集成测试配置
// 将所有对 db 模块的 import 映射到 db.local（内存适配器）
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.integration.test.ts'],
  moduleNameMapper: {
    // 匹配所有以 /db 结尾的 import 路径（./db, ../../lib/db 等）
    '(.*[\\\\/])db$': '$1db.local',
  },
}
