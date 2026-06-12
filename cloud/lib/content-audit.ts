import crypto from 'crypto'
import https from 'https'
import { URL } from 'url'
import * as db from './db'
import * as storage from './storage'
import { postWxJson } from './wx-openapi'
import type {
  AuditProvider,
  AuditTargetType,
  ContentAuditTask,
  Post,
  PostAuditStatus,
  PostContent,
  Section,
  Widget,
} from '../shared/types'

export const AUDIT_TASKS = 'content_audit_tasks'
const AUDIT_SCENE_FOR_POST = 3
const TEXT_CHUNK_LIMIT = 2400

interface AuditTarget {
  widgetId?: string
  type: AuditTargetType
  label: string
  text?: string
  fileID?: string
  url?: string
  forceManual?: boolean
  reason?: string
}

interface AuditSubmitResult {
  status: PostAuditStatus
  provider: AuditProvider
  traceId?: string
  jobId?: string
  suggest?: string
  label?: string | number
  reason?: string
  raw?: any
}

export function isPostVisibleToMembers(post: any): boolean {
  return post?.status === 'active' && (!post.auditStatus || post.auditStatus === 'pass')
}

export function isPostUnderAudit(post: any): boolean {
  return post?.auditStatus === 'pending' || post?.auditStatus === 'review' || Boolean(post?.pendingContent)
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeSuggest(value: unknown): PostAuditStatus {
  const suggest = String(value || '').trim().toLowerCase()
  if (['pass', 'normal', 'ok', '0'].includes(suggest)) return 'pass'
  if (['risky', 'block', 'blocked', 'reject', 'rejected', 'fail', 'failed', '1'].includes(suggest)) return 'rejected'
  if (['review', 'suspect', 'suspected', '2'].includes(suggest)) return 'review'
  return 'review'
}

function summarizeResults(results: AuditSubmitResult[]): { status: PostAuditStatus; reason: string } {
  if (results.length === 0) return { status: 'pass', reason: '' }
  const rejected = results.find((item) => item.status === 'rejected')
  if (rejected) return { status: 'rejected', reason: rejected.reason || rejected.suggest || 'content rejected by audit' }
  const review = results.find((item) => item.status === 'review')
  if (review) return { status: 'review', reason: review.reason || review.suggest || 'content needs manual review' }
  const pending = results.find((item) => item.status === 'pending')
  if (pending) return { status: 'pending', reason: 'media audit is pending' }
  return { status: 'pass', reason: '' }
}

function pushUnique(targets: AuditTarget[], next: AuditTarget) {
  const key = [next.type, next.widgetId || '', next.text || '', next.fileID || '', next.url || '', next.reason || ''].join('\u0001')
  if (!targets.some((item) => [item.type, item.widgetId || '', item.text || '', item.fileID || '', item.url || '', item.reason || ''].join('\u0001') === key)) {
    targets.push(next)
  }
}

function splitText(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += TEXT_CHUNK_LIMIT) chunks.push(text.slice(i, i + TEXT_CHUNK_LIMIT))
  return chunks
}

function addTextTargets(targets: AuditTarget[], widget: Widget | undefined, label: string, value: unknown) {
  if (typeof value !== 'string') return
  for (const chunk of splitText(value)) {
    pushUnique(targets, { widgetId: widget?.widgetId, type: 'text', label, text: chunk })
  }
}

function addCloudMediaTarget(targets: AuditTarget[], widget: Widget | undefined, type: AuditTargetType, label: string, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return
  const ref = value.trim()
  if (ref.startsWith('cloud://')) {
    pushUnique(targets, { widgetId: widget?.widgetId, type, label, fileID: ref })
  } else if (/^https?:\/\//i.test(ref)) {
    pushUnique(targets, { widgetId: widget?.widgetId, type, label, url: ref })
  }
}

export function extractAuditTargets(section: Section, content: PostContent): AuditTarget[] {
  const targets: AuditTarget[] = []
  const widgets = section.widgets || []
  for (const widget of widgets) {
    const value = content?.[widget.widgetId]
    if (value === undefined || value === null || value === '') continue
    const label = widget.label || widget.fieldKey || widget.widgetId

    if (['short_text', 'summary', 'rich_text'].includes(widget.type)) {
      addTextTargets(targets, widget, label, value)
      continue
    }

    if (widget.type === 'location' && value && typeof value === 'object') {
      addTextTargets(targets, widget, `${label} address`, (value as any).address)
      continue
    }

    if (widget.type === 'note_blocks' && Array.isArray(value)) {
      for (const block of value as any[]) {
        if (block?.type === 'text') addTextTargets(targets, widget, label, block.text)
        if (block?.type === 'image') addCloudMediaTarget(targets, widget, 'image', label, block.fileID)
      }
      continue
    }

    if (widget.type === 'rich_note' && value && typeof value === 'object') {
      const note = value as any
      addTextTargets(targets, widget, `${label} text`, note.text)
      addTextTargets(targets, widget, `${label} markdown`, note.markdown)
      if (Array.isArray(note.imageFileIDs)) {
        for (const fileID of note.imageFileIDs) addCloudMediaTarget(targets, widget, 'image', label, fileID)
      }
      continue
    }

    if (widget.type === 'image_group' && Array.isArray(value)) {
      for (const fileID of value) addCloudMediaTarget(targets, widget, 'image', label, fileID)
      continue
    }

    if (widget.type === 'audio_group' && Array.isArray(value)) {
      for (const item of value as any[]) {
        addTextTargets(targets, widget, `${label} title`, item?.title)
        addCloudMediaTarget(targets, widget, 'audio', label, item?.fileID)
        addCloudMediaTarget(targets, widget, 'image', `${label} cover`, item?.cover)
      }
      continue
    }

    if (widget.type === 'video_group' && Array.isArray(value)) {
      for (const item of value as any[]) {
        addTextTargets(targets, widget, `${label} title`, item?.title)
        addTextTargets(targets, widget, `${label} description`, item?.description)
        addCloudMediaTarget(targets, widget, 'image', `${label} cover`, item?.cover)
        if (item?.source === 'cos') {
          addCloudMediaTarget(targets, widget, 'video', label, item?.fileID)
        } else if (item?.source === 'h5' || item?.source === 'app_link') {
          addCloudMediaTarget(targets, widget, 'video', label, item?.url)
        } else {
          pushUnique(targets, {
            widgetId: widget.widgetId,
            type: 'video',
            label,
            forceManual: true,
            reason: `video source ${String(item?.source || 'unknown')} cannot be machine-audited from stored media`,
          })
        }
      }
    }
  }
  return targets
}

async function resolveTargetUrl(target: AuditTarget): Promise<string> {
  if (target.url) return target.url
  if (target.fileID) return storage.getTempUrl(target.fileID)
  return ''
}

async function submitWechatTarget(target: AuditTarget, openid: string): Promise<AuditSubmitResult> {
  if (!openid) {
    return { status: 'review', provider: 'manual', reason: 'missing openid for WeChat audit' }
  }
  try {
    if (target.type === 'text') {
      const payload = await postWxJson<any>('/wxa/msg_sec_check', {
        openid,
        scene: AUDIT_SCENE_FOR_POST,
        version: 2,
        content: target.text || '',
        title: target.label,
      })
      const status = normalizeSuggest(payload?.result?.suggest)
      return {
        status,
        provider: 'wechat',
        traceId: payload?.trace_id,
        suggest: payload?.result?.suggest,
        label: payload?.result?.label,
        raw: payload,
      }
    }

    if (target.type === 'image' || target.type === 'audio') {
      const mediaUrl = await resolveTargetUrl(target)
      if (!mediaUrl) return { status: 'review', provider: 'manual', reason: 'media url is empty' }
      const payload = await postWxJson<any>('/wxa/media_check_async', {
        openid,
        scene: AUDIT_SCENE_FOR_POST,
        version: 2,
        media_url: mediaUrl,
        media_type: target.type === 'audio' ? 1 : 2,
      })
      return {
        status: 'pending',
        provider: 'wechat',
        traceId: payload?.trace_id,
        raw: payload,
      }
    }
  } catch (error: any) {
    return {
      status: 'review',
      provider: 'manual',
      reason: `wechat audit unavailable: ${String(error?.message || error).slice(0, 200)}`,
    }
  }
  return { status: 'review', provider: 'manual', reason: `WeChat does not support ${target.type} audit` }
}

function ciConfig() {
  const secretId = String(process.env.TENCENT_SECRET_ID || process.env.TC_SECRET_ID || '').trim()
  const secretKey = String(process.env.TENCENT_SECRET_KEY || process.env.TC_SECRET_KEY || '').trim()
  const bucket = String(process.env.TENCENT_CI_BUCKET || '').trim()
  const region = String(process.env.TENCENT_CI_REGION || '').trim()
  return { secretId, secretKey, bucket, region, enabled: Boolean(secretId && secretKey && bucket && region) }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sha1Hex(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function hmacSha1Hex(key: string | Buffer, value: string) {
  return crypto.createHmac('sha1', key).update(value).digest('hex')
}

export function buildCiHttpString(method: 'POST', pathname: string, headers: Record<string, string>): string {
  const headerPairs = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return `${method.toLowerCase()}\n${pathname}\n\n${headerPairs}\n`
}

function detectTypeForTencentCi(type: AuditTargetType): string | null {
  if (type === 'image') return null
  return 'Porn,Terrorism,Politics,Ads,Illegal,Abuse'
}

export function buildTencentCiAuditRequestBody(type: AuditTargetType, inputXml: string): string {
  const imageBizType = String(process.env.TENCENT_CI_IMAGE_BIZ_TYPE || '').trim()
  const confXml = type === 'image' && imageBizType
    ? `<BizType>${xmlEscape(imageBizType)}</BizType>`
    : (detectTypeForTencentCi(type) ? `<DetectType>${detectTypeForTencentCi(type)}</DetectType>` : '')
  return `<Request><Input>${inputXml}</Input><Conf>${confXml}</Conf></Request>`
}

function ciAuthorization(method: 'POST', pathname: string, host: string, secretId: string, secretKey: string): string {
  const start = Math.floor(Date.now() / 1000)
  const end = start + 900
  const time = `${start};${end}`
  const httpString = buildCiHttpString(method, pathname, { host })
  const signKey = hmacSha1Hex(secretKey, time)
  const stringToSign = `sha1\n${time}\n${sha1Hex(httpString)}\n`
  const signature = hmacSha1Hex(signKey, stringToSign)
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${time}`,
    `q-key-time=${time}`,
    'q-header-list=host',
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&')
}

function postXml(urlStr: string, body: string, authorization: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Host: url.hostname,
        Authorization: authorization,
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function xmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].trim() : ''
}

export function parseTencentCiAuditResponse(type: AuditTargetType, body: string): AuditSubmitResult {
  const suggestion = xmlTag(body, 'Suggestion') || xmlTag(body, 'Result')
  const state = xmlTag(body, 'State')
  const code = xmlTag(body, 'Code')
  if (!suggestion && code && code !== '0') {
    const message = xmlTag(body, 'Message')
    return {
      status: 'review',
      provider: 'tencent_ci',
      reason: `Tencent CI ${code}: ${message || 'audit failed'}`,
      raw: body,
    }
  }
  const status = suggestion ? normalizeSuggest(suggestion) : (type === 'audio' || type === 'video' || state === 'Submitted' ? 'pending' : 'review')
  return {
    status,
    provider: 'tencent_ci',
    jobId: xmlTag(body, 'JobId'),
    suggest: suggestion,
    label: xmlTag(body, 'Label'),
    raw: body,
  }
}

async function submitTencentTarget(target: AuditTarget): Promise<AuditSubmitResult> {
  const cfg = ciConfig()
  if (!cfg.enabled) {
    return { status: 'review', provider: 'manual', reason: 'Tencent CI audit is not configured' }
  }
  try {
    const pathByType: Record<AuditTargetType, string> = {
      text: '/text/auditing',
      image: '/image/auditing',
      audio: '/audio/auditing',
      video: '/video/auditing',
    }
    const pathname = pathByType[target.type]
    const host = `${cfg.bucket}.ci.${cfg.region}.myqcloud.com`
    const url = `https://${host}${pathname}`
    const inputXml = target.type === 'text'
      ? `<Content>${Buffer.from(target.text || '', 'utf-8').toString('base64')}</Content>`
      : `<Url>${xmlEscape(await resolveTargetUrl(target))}</Url>`
    const body = buildTencentCiAuditRequestBody(target.type, inputXml)
    const res = await postXml(url, body, ciAuthorization('POST', pathname, host, cfg.secretId, cfg.secretKey))
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { status: 'review', provider: 'manual', reason: `Tencent CI HTTP ${res.statusCode}: ${res.body.slice(0, 200)}` }
    }
    return parseTencentCiAuditResponse(target.type, res.body)
  } catch (error: any) {
    return {
      status: 'review',
      provider: 'manual',
      reason: `Tencent CI audit unavailable: ${String(error?.message || error).slice(0, 200)}`,
    }
  }
}

async function submitTarget(target: AuditTarget, source: 'user' | 'admin', openid: string): Promise<AuditSubmitResult> {
  if (target.forceManual) return { status: 'review', provider: 'manual', reason: target.reason || 'manual review required' }
  if (source === 'user' && (target.type === 'text' || target.type === 'image' || target.type === 'audio')) {
    return submitWechatTarget(target, openid)
  }
  return submitTencentTarget(target)
}

async function createAuditTask(params: {
  postId: string
  communityId: string
  sectionId: string
  contentSlot: 'content' | 'pendingContent'
  target: AuditTarget
  result: AuditSubmitResult
}) {
  const now = nowIso()
  await db.create(AUDIT_TASKS, {
    postId: params.postId,
    communityId: params.communityId,
    sectionId: params.sectionId,
    widgetId: params.target.widgetId || '',
    contentSlot: params.contentSlot,
    targetType: params.target.type,
    provider: params.result.provider,
    status: params.result.status,
    targetLabel: params.target.label,
    targetRef: params.target.fileID || params.target.url || '',
    traceId: params.result.traceId || '',
    jobId: params.result.jobId || '',
    suggest: params.result.suggest || '',
    label: params.result.label || '',
    reason: params.result.reason || '',
    raw: params.result.raw || null,
    createdAt: now,
    updatedAt: now,
  })
}

export async function auditPostContent(params: {
  postId: string
  communityId: string
  sectionId: string
  section: Section
  content: PostContent
  authorId: string
  source: 'user' | 'admin'
  contentSlot?: 'content' | 'pendingContent'
}): Promise<{ status: PostAuditStatus; reason: string }> {
  const targets = extractAuditTargets(params.section, params.content)
  const results: AuditSubmitResult[] = []
  for (const target of targets) {
    const result = await submitTarget(target, params.source, params.authorId)
    results.push(result)
    await createAuditTask({
      postId: params.postId,
      communityId: params.communityId,
      sectionId: params.sectionId,
      contentSlot: params.contentSlot || 'content',
      target,
      result,
    })
  }
  return summarizeResults(results)
}

export async function applyAuditSummary(postId: string, slot: 'content' | 'pendingContent', status: PostAuditStatus, reason = '') {
  const now = nowIso()
  if (slot === 'pendingContent') {
    if (status === 'pass') {
      const post = await db.getById('posts', postId) as Post
      if (!post) throw new Error('post not found')
      if (!post.pendingContent) {
        await db.updateById('posts', postId, {
          pendingAuditStatus: 'pass',
          pendingAuditReason: '',
          auditUpdatedAt: now,
        })
        return
      }
      await db.updateById('posts', postId, {
        content: db.replaceValue(post.pendingContent),
        pendingContent: db.removeField(),
        pendingAuditStatus: 'pass',
        pendingAuditReason: '',
        auditStatus: 'pass',
        auditReason: '',
        auditUpdatedAt: now,
        updatedAt: now,
      })
      return
    }
    await db.updateById('posts', postId, {
      pendingAuditStatus: status,
      pendingAuditReason: reason,
      auditUpdatedAt: now,
    })
    return
  }

  await db.updateById('posts', postId, {
    auditStatus: status,
    auditReason: reason,
    auditUpdatedAt: now,
  })
}

export async function auditAndApply(params: {
  postId: string
  communityId: string
  sectionId: string
  section: Section
  content: PostContent
  authorId: string
  source: 'user' | 'admin'
  contentSlot?: 'content' | 'pendingContent'
}) {
  const summary = await auditPostContent(params)
  await applyAuditSummary(params.postId, params.contentSlot || 'content', summary.status, summary.reason)
  return summary
}

async function refreshPostAuditFromTasks(postId: string, slot: 'content' | 'pendingContent') {
  const tasks = await db.query(AUDIT_TASKS, { postId, contentSlot: slot }) as ContentAuditTask[]
  const summary = summarizeResults(tasks.map((task) => ({
    status: task.status,
    provider: task.provider,
    suggest: task.suggest,
    label: task.label,
    reason: task.reason,
  })))
  await applyAuditSummary(postId, slot, summary.status, summary.reason)
  return summary
}

export async function handleAuditCallback(params: any) {
  const expectedToken = String(process.env.AUDIT_CALLBACK_TOKEN || '').trim()
  const token = String(params.callbackToken || params.token || '').trim()
  if (!expectedToken) throw new Error('audit callback token is not configured')
  if (token !== expectedToken) throw new Error('invalid audit callback token')

  const traceId = String(params.traceId || params.trace_id || '').trim()
  const jobId = String(params.jobId || params.JobId || '').trim()
  const suggest = params.suggest || params.Suggestion || params?.result?.suggest || params?.Result
  const label = params.label || params.Label || params?.result?.label
  const status = normalizeSuggest(suggest)
  const now = nowIso()

  let tasks: ContentAuditTask[] = []
  if (traceId) tasks = await db.query(AUDIT_TASKS, { traceId }) as ContentAuditTask[]
  if (tasks.length === 0 && jobId) tasks = await db.query(AUDIT_TASKS, { jobId }) as ContentAuditTask[]
  if (tasks.length === 0) return { success: true, matched: 0 }

  for (const task of tasks) {
    await db.updateById(AUDIT_TASKS, task._id, {
      status,
      suggest: String(suggest || ''),
      label: label || '',
      raw: params,
      updatedAt: now,
    })
  }

  const pairs = Array.from(new Set(tasks.map((task) => `${task.postId}\u0001${task.contentSlot}`)))
  for (const pair of pairs) {
    const [postId, slot] = pair.split('\u0001') as [string, 'content' | 'pendingContent']
    await refreshPostAuditFromTasks(postId, slot)
  }
  return { success: true, matched: tasks.length, status }
}

export async function approvePostAudit(postId: string) {
  const post = await db.getById('posts', postId) as Post
  if (!post) throw new Error('post not found')
  if (post.pendingContent) await applyAuditSummary(postId, 'pendingContent', 'pass', '')
  else await applyAuditSummary(postId, 'content', 'pass', '')
  return { success: true }
}

export async function rejectPostAudit(postId: string, reason: string) {
  const post = await db.getById('posts', postId) as Post
  if (!post) throw new Error('post not found')
  if (post.pendingContent) {
    await applyAuditSummary(postId, 'pendingContent', 'rejected', reason || 'rejected by superAdmin')
  } else {
    await applyAuditSummary(postId, 'content', 'rejected', reason || 'rejected by superAdmin')
  }
  return { success: true }
}
