import { createHash } from 'crypto'

export function archivePostTopicId(postId: string, topicKey: string): string {
  const digest = createHash('sha1').update(`${postId}\u0000${topicKey}`).digest('hex')
  return `apt_${digest}`
}

export function buildArchiveSortKey(createdAt: string, postId: string): string {
  return `${createdAt}_${postId}`
}
