import { normalizeTopics } from '../../../cloud/shared/topics'

export { MAX_TOPIC_COUNT, MAX_TOPIC_LENGTH, normalizeTopics } from '../../../cloud/shared/topics'

export function appendTopic(currentTopics: unknown, topic: string): string[] {
  const current = Array.isArray(currentTopics) ? currentTopics : []
  return normalizeTopics(current.concat(topic))
}

export function removeTopic(currentTopics: unknown, index: number): string[] {
  if (!Array.isArray(currentTopics)) return []
  return normalizeTopics(currentTopics.filter((_topic, topicIndex) => topicIndex !== index))
}
