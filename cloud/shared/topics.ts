export const MAX_TOPIC_COUNT = 5
export const MAX_TOPIC_LENGTH = 20

function topicLength(value: string): number {
  let length = 0
  for (let index = 0; index < value.length; index += 1) {
    const high = value.charCodeAt(index)
    if (high >= 0xd800 && high <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) index += 1
    }
    length += 1
  }
  return length
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
