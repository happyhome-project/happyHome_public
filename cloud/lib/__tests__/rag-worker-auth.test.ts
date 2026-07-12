import { assertPostRagWorkerAuthorized } from '../rag-worker-auth'

const env = { POST_RAG_WORKER_TOKEN: 'secret' } as NodeJS.ProcessEnv

test('Timer authentication reads only a JSON Message token', () => {
  expect(() => assertPostRagWorkerAuthorized({ Type: 'Timer', TriggerName: 'post-rag-worker-every-minute' }, env)).toThrow('Unauthorized')
  expect(() => assertPostRagWorkerAuthorized({ Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', workerToken: 'secret' }, env)).toThrow('Unauthorized')
  expect(() => assertPostRagWorkerAuthorized({ Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Message: '{bad-json' }, env)).toThrow('Unauthorized')
  expect(assertPostRagWorkerAuthorized({ Type: 'Timer', TriggerName: 'post-rag-worker-every-minute', Message: JSON.stringify({ workerToken: 'secret' }) }, env)).toEqual({ source: 'timer' })
})

test('manual token and bearer authentication remain supported and classified as manual', () => {
  expect(assertPostRagWorkerAuthorized({ workerToken: 'secret' }, env)).toEqual({ source: 'manual' })
  expect(assertPostRagWorkerAuthorized({ headers: { Authorization: 'Bearer secret' } }, env)).toEqual({ source: 'manual' })
})
