import {
  parsePerformanceTrace,
  recordDatabaseStage,
} from '../performance-trace'

test('parsePerformanceTrace 只接受有限白名单字段和值', () => {
  expect(parsePerformanceTrace({
    requestId: 'req_123',
    stage: 'community.directory',
    sample: 'warm',
    counts: { communities: 50, memberships: 5 },
  })).toEqual({
    requestId: 'req_123',
    stage: 'community.directory',
    sample: 'warm',
    counts: { communities: 50, memberships: 5 },
  })

  expect(parsePerformanceTrace({
    requestId: 'req_123',
    stage: 'login',
    sample: 'warm',
    nickName: '不应进入日志',
  })).toBeNull()
  expect(parsePerformanceTrace({ requestId: '含个人信息', stage: 'login', sample: 'warm' })).toBeNull()
  expect(parsePerformanceTrace({
    requestId: 'req_123',
    stage: 'login',
    sample: 'warm',
    counts: Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`k${index}`, index])),
  })).toBeNull()
  expect(parsePerformanceTrace({
    requestId: 'req_123',
    stage: 'login',
    sample: 'warm',
    counts: { users: -1 },
  })).toBeNull()
  expect(parsePerformanceTrace({
    requestId: 'req_123',
    stage: 'login',
    sample: 'warm',
    counts: { openid: 123456 },
  })).toBeNull()
})

test('recordDatabaseStage 仅在 trace 有效时输出无敏感阶段日志', () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
  const trace = parsePerformanceTrace({ requestId: 'req_123', stage: 'login', sample: 'cold' })

  recordDatabaseStage(trace, 'user.login', 'user_and_admin_read', Date.now() - 5, { users: 1 })
  recordDatabaseStage(null, 'user.login', 'ignored', Date.now())

  expect(info).toHaveBeenCalledTimes(1)
  expect(info).toHaveBeenCalledWith('[performance.trace]', expect.stringContaining('"requestId":"req_123"'))
  expect(info).toHaveBeenCalledWith('[performance.trace]', expect.stringContaining('"dbStage":"user_and_admin_read"'))
  expect(info).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('nickName'))
  info.mockRestore()
})
