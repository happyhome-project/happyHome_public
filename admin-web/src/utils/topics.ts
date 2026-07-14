export const MAX_TOPIC_COUNT = 5
export const MAX_TOPIC_LENGTH = 20

export type TopicValidationResult =
  | { ok: true; topics: string[] }
  | { ok: false; message: string }

export type AppendTopicResult =
  | { ok: true; topics: string[]; duplicate: boolean }
  | { ok: false; message: string }

export function topicUnicodeLength(value: string): number {
  return Array.from(value).length
}

export function normalizeTopicText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^#+\s*/u, '')
    .trim()
}

export function validateAndNormalizeTopics(value: unknown): TopicValidationResult {
  if (!Array.isArray(value)) return { ok: false, message: '话题格式不正确' }

  const topics: string[] = []
  const seen = new Set<string>()
  for (const rawTopic of value) {
    if (typeof rawTopic !== 'string') return { ok: false, message: '话题格式不正确' }
    const topic = normalizeTopicText(rawTopic)
    if (!topic) continue
    if (topicUnicodeLength(topic) > MAX_TOPIC_LENGTH) {
      return { ok: false, message: `每个话题最多 ${MAX_TOPIC_LENGTH} 个字符` }
    }

    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    if (topics.length >= MAX_TOPIC_COUNT) {
      return { ok: false, message: `最多添加 ${MAX_TOPIC_COUNT} 个话题` }
    }
    seen.add(key)
    topics.push(topic)
  }

  return { ok: true, topics }
}

export function appendTopic(value: unknown, rawTopic: unknown): AppendTopicResult {
  const current = validateAndNormalizeTopics(value)
  if (!current.ok) return current
  if (typeof rawTopic !== 'string') return { ok: false, message: '话题格式不正确' }

  const topic = normalizeTopicText(rawTopic)
  if (!topic) return { ok: false, message: '请输入话题' }
  if (topicUnicodeLength(topic) > MAX_TOPIC_LENGTH) {
    return { ok: false, message: `每个话题最多 ${MAX_TOPIC_LENGTH} 个字符` }
  }

  const duplicate = current.topics.some((item) => item.toLowerCase() === topic.toLowerCase())
  if (duplicate) return { ok: true, topics: current.topics, duplicate: true }
  if (current.topics.length >= MAX_TOPIC_COUNT) {
    return { ok: false, message: `最多添加 ${MAX_TOPIC_COUNT} 个话题` }
  }

  return { ok: true, topics: [...current.topics, topic], duplicate: false }
}

