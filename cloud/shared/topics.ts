export const MAX_TOPIC_COUNT = 5
export const MAX_TOPIC_LENGTH = 20

function topicLength(value: string): number {
  return Array.from(value).length
}

export function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('话题必须是数组')
  }

  const normalizedTopics: string[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error('话题必须是字符串')
    }

    const topic = item
      .normalize('NFKC')
      .trim()
      .replace(/^#+\s*/, '')
      .trim()

    if (!topic) continue
    if (topicLength(topic) > MAX_TOPIC_LENGTH) {
      throw new Error(`每个话题不能超过 ${MAX_TOPIC_LENGTH} 个字符`)
    }

    const dedupeKey = topic.toLowerCase()
    if (seen.has(dedupeKey)) continue
    if (normalizedTopics.length >= MAX_TOPIC_COUNT) {
      throw new Error(`最多添加 ${MAX_TOPIC_COUNT} 个话题`)
    }

    seen.add(dedupeKey)
    normalizedTopics.push(topic)
  }

  return normalizedTopics
}
