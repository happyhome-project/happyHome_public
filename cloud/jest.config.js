module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['\\.integration\\.test\\.ts$', '\\.cloud\\.test\\.ts$'],
}
