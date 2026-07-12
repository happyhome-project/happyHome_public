const REQUIRED_SHARED = [
  'TENCENT_RAG_ES_ENDPOINT', 'TENCENT_RAG_ES_USERNAME', 'TENCENT_RAG_ES_PASSWORD',
  'TENCENT_RAG_INDEX_NAME', 'TENCENT_RAG_VECTOR_FIELD', 'TENCENT_RAG_ATOMIC_SECRET_ID',
  'TENCENT_RAG_ATOMIC_SECRET_KEY', 'TENCENT_RAG_ATOMIC_REGION', 'TENCENT_RAG_EMBEDDING_MODEL',
]

export function buildPostSemanticFunctionEnvironments(source) {
  const required = [...REQUIRED_SHARED, 'POST_RAG_WORKER_TOKEN', 'POST_RAG_SMOKE_IDENTITY_SECRET']
  for (const key of required) if (!String(source[key] || '').trim()) throw new Error(`Missing ${key}`)
  if (String(source.TENCENT_RAG_VECTOR_FIELD).trim() !== 'embedding') throw new Error('v2 writer requires vector field embedding')
  let endpoint
  try { endpoint = new URL(source.TENCENT_RAG_ES_ENDPOINT) } catch { throw new Error('TENCENT_RAG_ES_ENDPOINT must be HTTPS') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('TENCENT_RAG_ES_ENDPOINT must be HTTPS without inline credentials')
  const shared = Object.fromEntries(REQUIRED_SHARED.map(key => [key, String(source[key]).trim()]))
  return {
    post: { ...shared, POST_RAG_SMOKE_IDENTITY_SECRET: String(source.POST_RAG_SMOKE_IDENTITY_SECRET) },
    'post-rag-worker': { ...shared, POST_RAG_WORKER_TOKEN: String(source.POST_RAG_WORKER_TOKEN) },
  }
}
