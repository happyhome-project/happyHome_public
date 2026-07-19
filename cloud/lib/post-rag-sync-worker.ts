import { createHash } from 'crypto'
import type { Community, Post, RagIndexPolicy, Section } from '../shared/types'
import * as db from './db'
import { loadPostContentSection } from './post-content-contract'
import {
  buildCurrentPostRagChunks,
  createTencentRagProviderFromEnv,
  enqueueVideoRagAnalysisJobs,
  planVideoRagAnalysisJobsForPost,
  readVideoRagCostPolicyFromEnv,
  upsertPostRagIndexState,
  POST_RAG_INDEX_STATE,
  POST_RAG_WORKER_STATE,
  type TencentRagProvider,
  type VideoRagCostPolicy,
} from './post-rag'
import { isPostEligibleForTrustedRag, resolvePostRagProjectionInputs } from './post-rag-indexing'
import {
  claimPostRagSync,
  completePostRagSync,
  failPostRagSync,
  listPostRagSyncCandidates,
  type ClaimedPostRagSync,
  type RagIndexPolicy as SyncRagIndexPolicy,
} from './post-rag-sync'

function removalVersion(input: Record<string, unknown>) {
  return `removed-${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`
}

function policyScope(community: Community | null, post: Post | null): Exclude<RagIndexPolicy, 'excluded'> | null {
  if (!community || !post || community.fixtureKey || post.fixtureKey) return null
  if (community.ragIndexPolicy !== 'business' && community.ragIndexPolicy !== 'validation') return null
  if (post.ragIndexPolicy === 'excluded') return null
  if (post.ragIndexPolicy && post.ragIndexPolicy !== community.ragIndexPolicy) return null
  return community.ragIndexPolicy
}

async function readOptional<T>(collectionName: string, id: string): Promise<T | null> {
  if (!id) return null
  return db.getByIdOrNull<T>(collectionName, id)
}

async function resolveCurrentSource(claim: ClaimedPostRagSync) {
  const post = await readOptional<Post>('posts', claim.postId)
  const communityId = String(post?.communityId || claim.communityId || '').trim()
  const community = await readOptional<Community>('communities', communityId)
  const storedSection = post
    ? await loadPostContentSection(post, (collectionName, id) => readOptional(collectionName, id))
    : null
  const resolved = post ? resolvePostRagProjectionInputs(post, storedSection) : null
  const scope = policyScope(community, post)
  const eligible = Boolean(
    community
    && community.status === 'active'
    && scope
    && resolved
    && isPostEligibleForTrustedRag(resolved.post, resolved.section),
  )
  return {
    post,
    community,
    section: resolved?.section || null,
    searchablePost: resolved?.post || null,
    scope,
    eligible,
  }
}

function updateMatchedDocument(result: any) {
  const stats = result?.stats || result
  return Number(stats?.updated ?? stats?.updatedCount ?? stats?.ModifiedCount ?? 0) > 0
}

async function updateWorkerState(data: Record<string, unknown>) {
  const result = await db.updateById(POST_RAG_WORKER_STATE, 'post-rag-worker', data).catch(() => null)
  if (updateMatchedDocument(result)) return
  await db.create(POST_RAG_WORKER_STATE, { _id: 'post-rag-worker', ...data }).catch(() => null)
}

function errorCodeFor(error: unknown) {
  const value = error as { code?: unknown; retryable?: unknown }
  const code = String(value?.code || '')
  if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return { code, retryable: value.retryable !== false }
  if (String((error as Error)?.message || '') === 'rag_provider_not_configured') {
    return { code: 'PROVIDER_NOT_CONFIGURED', retryable: true }
  }
  return { code: 'PROVIDER_FAILED', retryable: true }
}

export interface ProcessPostRagSyncOptions {
  provider?: TencentRagProvider
  videoPolicy?: VideoRagCostPolicy
  now?: () => string
}

export async function processClaimedPostRagSync(
  claim: ClaimedPostRagSync,
  options: ProcessPostRagSyncOptions = {},
) {
  const provider = options.provider || createTencentRagProviderFromEnv()
  const now = options.now || (() => new Date().toISOString())
  try {
    const current = await resolveCurrentSource(claim)
    const indexState = await readOptional<Record<string, any>>(POST_RAG_INDEX_STATE, claim.postId)
    if (!current.eligible || !current.searchablePost || !current.section || !current.scope) {
      const sourceVersion = removalVersion({
        postId: claim.postId,
        postStatus: current.post?.status || 'missing',
        auditStatus: current.post?.auditStatus || null,
        communityStatus: current.community?.status || 'missing',
        policy: current.community?.ragIndexPolicy || 'unclassified',
        fixture: Boolean(current.community?.fixtureKey || current.post?.fixtureKey),
        sectionStatus: current.section?.status || 'missing',
      })
      const hadAppliedEvidence = indexState?.status === 'indexed' || Boolean(claim.appliedSourceVersion && claim.indexScope)
      if (hadAppliedEvidence) {
        if (!provider.isConfigured()) throw new Error('rag_provider_not_configured')
        await provider.deletePostChunks?.(claim.postId)
      }
      await upsertPostRagIndexState(claim.postId, {
        status: 'removed',
        communityId: String(current.post?.communityId || claim.communityId || ''),
        sectionId: String(current.post?.sectionId || claim.sectionId || ''),
        sourceVersion,
        indexScope: null,
        chunkCount: 0,
        indexedAt: now(),
      })
      const completion = await completePostRagSync({
        postId: claim.postId,
        workerId: claim.leaseOwner,
        leaseToken: claim.leaseToken,
        desiredRevision: claim.desiredRevision,
        sourceVersion,
        indexScope: null,
        now: now(),
      })
      return { postId: claim.postId, outcome: 'removed' as const, providerCalled: hadAppliedEvidence, completion }
    }

    if (!provider.isConfigured()) throw new Error('rag_provider_not_configured')
    const built = await buildCurrentPostRagChunks(current.searchablePost, current.section, current.scope, now())
    await provider.ensureIndex?.()
    await provider.deletePostChunks?.(claim.postId)
    await provider.upsertChunks?.(built.chunks)

    const videoPolicy = options.videoPolicy || readVideoRagCostPolicyFromEnv()
    const videoJobs = built.videoRag
      ? planVideoRagAnalysisJobsForPost(current.searchablePost, current.section, {
        now: now(),
        assetsByCacheKey: built.videoRag.assetsByCacheKey,
        policy: videoPolicy,
      })
      : []
    const videoJobResult = await enqueueVideoRagAnalysisJobs(videoJobs)
    await upsertPostRagIndexState(claim.postId, {
      status: 'indexed',
      communityId: current.searchablePost.communityId,
      sectionId: String(current.searchablePost.sectionId || ''),
      sourceVersion: built.sourceVersion,
      sourceUpdatedAt: current.searchablePost.updatedAt || current.searchablePost.createdAt,
      indexScope: current.scope,
      chunkCount: built.chunks.length,
      indexedAt: now(),
      videoRag: {
        metadataChunkCount: built.videoRag?.metadataChunkCount || 0,
        analysisChunkCount: built.videoRag?.analysisChunkCount || 0,
        analysisJobQueuedCount: videoJobResult.queuedCount,
        analysisJobSkippedCount: videoJobResult.skippedCount,
      },
    })
    const completion = await completePostRagSync({
      postId: claim.postId,
      workerId: claim.leaseOwner,
      leaseToken: claim.leaseToken,
      desiredRevision: claim.desiredRevision,
      sourceVersion: built.sourceVersion,
      indexScope: current.scope as SyncRagIndexPolicy,
      now: now(),
    })
    return { postId: claim.postId, outcome: 'indexed' as const, providerCalled: true, chunkCount: built.chunks.length, completion }
  } catch (error) {
    const failure = errorCodeFor(error)
    await failPostRagSync({
      postId: claim.postId,
      workerId: claim.leaseOwner,
      leaseToken: claim.leaseToken,
      desiredRevision: claim.desiredRevision,
      errorCode: failure.code,
      retryable: failure.retryable,
      now: now(),
    })
    return { postId: claim.postId, outcome: 'failed' as const, errorCode: failure.code }
  }
}

export async function processPostRagSyncBatch(input: {
  limit?: number
  postId?: string
  workerId: string
  provider?: TencentRagProvider
  videoPolicy?: VideoRagCostPolicy
  now?: () => string
}) {
  const now = input.now || (() => new Date().toISOString())
  const startedAt = now()
  const candidates = await listPostRagSyncCandidates({ now: startedAt, limit: input.limit || 5, postId: input.postId })
  const results = []
  for (const candidate of candidates) {
    const claim = await claimPostRagSync(candidate.postId, { workerId: input.workerId, now: now(), leaseMs: 5 * 60_000 })
    if (!claim) continue
    results.push(await processClaimedPostRagSync(claim, {
      provider: input.provider,
      videoPolicy: input.videoPolicy,
      now,
    }))
  }
  const failedCount = results.filter((result) => result.outcome === 'failed').length
  await updateWorkerState({
    status: failedCount ? 'completed_with_errors' : 'completed',
    lastRunAt: startedAt,
    lastCompletedAt: now(),
    lastScannedCount: candidates.length,
    lastOkCount: results.length - failedCount,
    lastFailedCount: failedCount,
    lastErrorCode: results.find((result) => result.outcome === 'failed')?.errorCode || '',
  })
  return { scannedCount: candidates.length, results }
}
