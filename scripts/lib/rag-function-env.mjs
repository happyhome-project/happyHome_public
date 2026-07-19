const SHARED_KEYS = [
  'TENCENT_RAG_PROVIDER', 'TENCENT_RAG_CLOUDBASE_CHUNK_PAGE_SIZE', 'TENCENT_RAG_CLOUDBASE_MAX_CANDIDATE_CHUNKS',
  'TENCENT_RAG_ATOMIC_SECRET_ID', 'TENCENT_RAG_ATOMIC_SECRET_KEY', 'TENCENT_RAG_ATOMIC_REGION',
  'TENCENT_RAG_EMBEDDING_MODEL', 'TENCENT_RAG_RERANK_MODEL', 'TENCENT_RAG_LLM_MODEL',
]

export function buildRagFunctionEnvironments(source) {
  const required = [...SHARED_KEYS, 'POST_RAG_WORKER_TOKEN', 'POST_RAG_TIMER_TOKEN', 'POST_RAG_SMOKE_IDENTITY_SECRET']
  for (const key of required) if (!String(source[key] || '').trim()) throw new Error(`Missing ${key}`)
  if (String(source.TENCENT_RAG_PROVIDER).trim() !== 'cloudbase') throw new Error('formal RAG provider must be cloudbase')
  const shared = Object.fromEntries(SHARED_KEYS.map((key) => [key, String(source[key]).trim()]))
  const workerToken = String(source.POST_RAG_WORKER_TOKEN).trim()
  const timerToken = String(source.POST_RAG_TIMER_TOKEN).trim()
  if (workerToken === timerToken) throw new Error('POST_RAG_TIMER_TOKEN must differ from POST_RAG_WORKER_TOKEN')
  return {
    post: { ...shared, POST_RAG_SMOKE_IDENTITY_SECRET: String(source.POST_RAG_SMOKE_IDENTITY_SECRET).trim() },
    'post-rag-worker': { ...shared, POST_RAG_WORKER_TOKEN: workerToken, POST_RAG_TIMER_TOKEN: timerToken },
  }
}
