import { assertPostRagWorkerAuthorized } from '../rag-worker-auth'

const NOW = '2026-07-12T00:01:00.000Z'
const env = {
  POST_RAG_WORKER_TOKEN: 'worker-secret',
  POST_RAG_TIMER_TOKEN: 'timer-secret',
  POST_RAG_TIMER_TRIGGER_NAME: 'post-rag-worker-every-minute',
} as NodeJS.ProcessEnv
const authorize = (event: unknown, overrides: NodeJS.ProcessEnv = env) => (assertPostRagWorkerAuthorized as any)(event, overrides, { now: () => NOW })

test('manual calls accept only the worker capability', () => {
  expect(authorize({ workerToken: 'worker-secret' })).toEqual({ source: 'manual' })
  expect(authorize({ headers: { Authorization: 'Bearer worker-secret' } })).toEqual({ source: 'manual' })
  expect(() => authorize({ timerToken: 'timer-secret' })).toThrow('Unauthorized')
  expect(() => authorize({ workerToken: 'timer-secret' })).toThrow('Unauthorized')
})

test('Timer accepts only the independent timerToken in Message', () => {
  const base = { Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-12T00:00:30Z' }
  expect(authorize({ ...base, Message: JSON.stringify({ timerToken: 'timer-secret' }) })).toEqual({ source: 'timer' })
  expect(() => authorize({ ...base, Message: JSON.stringify({ workerToken: 'worker-secret' }) })).toThrow('Unauthorized')
  expect(() => authorize({ ...base, Message: JSON.stringify({ timerToken: 'timer-secret', workerToken: 'worker-secret' }) })).toThrow('Unauthorized')
  expect(() => authorize({ ...base, workerToken: 'worker-secret' })).toThrow('Unauthorized')
})

test.each([
  ['wrong trigger', { TriggerName: 'attacker-timer', Time: '2026-07-12T00:00:30Z' }],
  ['stale time', { TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-11T23:58:59Z' }],
  ['future time', { TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-12T00:03:01Z' }],
  ['non-UTC time', { TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-12T08:00:30+08:00' }],
  ['invalid time', { TriggerName: 'post-rag-worker-every-minute', Time: 'not-a-time' }],
] as const)('Timer rejects %s', (_label, fields) => {
  expect(() => authorize({ Type: 'Timer', ...fields, Message: JSON.stringify({ timerToken: 'timer-secret' }) })).toThrow('Unauthorized')
})

test('Timer requires separately configured token and uses the owned default trigger name', () => {
  const defaultTriggerEnv = { POST_RAG_WORKER_TOKEN: 'worker-secret', POST_RAG_TIMER_TOKEN: 'timer-secret' } as NodeJS.ProcessEnv
  expect(authorize({ Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-12T00:00:30Z', Message: JSON.stringify({ timerToken: 'timer-secret' }) }, defaultTriggerEnv)).toEqual({ source: 'timer' })
  expect(() => authorize({ Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Time: '2026-07-12T00:00:30Z', Message: JSON.stringify({ timerToken: 'worker-secret' }) }, { POST_RAG_WORKER_TOKEN: 'worker-secret' } as NodeJS.ProcessEnv)).toThrow('post RAG timer token is not configured')
})
