import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'ensure-indexes.mjs'), 'utf8')

test('ensure-indexes creates every CloudBase collection used by formal post RAG state', () => {
  assert.match(source, /post_rag_sync_state/)
  assert.match(source, /idx_status_nextAttemptAt/)
  assert.match(source, /post_rag_jobs/)
  assert.match(source, /post_rag_index_state/)
  assert.match(source, /post_rag_worker_state/)
  assert.match(source, /post_rag_smoke_runs/)
  assert.match(source, /post_video_rag_assets/)
  assert.match(source, /post_video_rag_jobs/)
})

test('ensure-indexes creates membership idempotency collections before indexing them', () => {
  assert.match(source, /const REQUIRED_COLLECTIONS = \[[\s\S]*'community_member_states'/)
  assert.match(source, /const REQUIRED_COLLECTIONS = \[[\s\S]*'community_create_requests'/)
})

test('ensure-indexes treats CloudBase already-exists races as idempotent success', () => {
  assert.match(source, /function isAlreadyExistsError/)
  assert.match(source, /Table exist/)
  assert.match(source, /already exists/)
  assert.match(source, /= collection \$\{coll\} \(already exists\)/)
})

test('ensure-indexes includes the membership critical-path compound indexes', () => {
  assert.match(source, /idx_userId_status_joinedAt[\s\S]*userId[\s\S]*status[\s\S]*joinedAt/)
  assert.match(source, /idx_userId_appliedAt[\s\S]*userId[\s\S]*appliedAt/)
  assert.match(source, /idx_communityId_userId_appliedAt[\s\S]*communityId[\s\S]*userId[\s\S]*appliedAt/)
  assert.match(source, /idx_communityId_userId_status[\s\S]*communityId[\s\S]*userId[\s\S]*status/)
})

test('ensure-indexes includes the archive feed compound index', () => {
  assert.match(source, /idx_communityId_area_status_auditStatus_sortKey[\s\S]*communityId[\s\S]*area[\s\S]*status[\s\S]*auditStatus[\s\S]*sortKey/)
  assert.match(source, /archive_topics/)
  assert.match(source, /idx_communityId_enabled_legacyOrder/)
  assert.match(source, /idx_communityId_enabled_adminOrder/)
  assert.match(source, /idx_communityId_enabled_recentScore/)
  assert.match(source, /archive_post_topics/)
  assert.match(source, /idx_communityId_topicKey_status_auditStatus_sortKey/)
})

test('ensure-indexes provisions global collaboration templates and section-free post indexes', () => {
  assert.match(source, /const REQUIRED_COLLECTIONS = \[[\s\S]*'collaboration_templates'/)
  assert.match(source, /idx_collaboration_systemKey_unique[\s\S]*systemKey/)
  assert.match(source, /idx_collaboration_status_order[\s\S]*status[\s\S]*order/)
  assert.match(source, /idx_communityId_area_template_status_createdAt[\s\S]*communityId[\s\S]*area[\s\S]*collaborationTemplateId[\s\S]*status[\s\S]*createdAt/)
})

test('ensure-indexes supports reverse attendance lookup for my activities', () => {
  assert.match(source, /post_attendance_members[\s\S]*idx_userId_id[\s\S]*userId[\s\S]*_id/)
})
