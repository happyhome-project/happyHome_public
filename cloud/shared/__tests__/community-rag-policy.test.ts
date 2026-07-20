import {
  deriveCommunityRagIndexPolicy,
  resolveCommunityRagIndexPolicy,
} from '../community-rag-policy'

test.each([
  ['青山村', 'business'],
  ['HappyHome 中文社区', 'business'],
  ['𠀀', 'business'],
  ['HH RELEASE SMOKE', 'excluded'],
  ['123-TEST', 'excluded'],
] as const)('社区名 %s 派生为 %s', (name, expected) => {
  expect(deriveCommunityRagIndexPolicy(name)).toBe(expected)
})

test('validation 社区改名后仍保持隔离', () => {
  expect(resolveCommunityRagIndexPolicy({
    name: 'English validation',
    currentPolicy: 'validation',
  })).toBe('validation')
})

test('fixture 社区即使含中文也必须排除', () => {
  expect(resolveCommunityRagIndexPolicy({
    name: '固定测试社区',
    fixtureKey: 'fixture-1',
    currentPolicy: 'business',
  })).toBe('excluded')
})
