
import type { Post, Section } from '../../shared/types'
import {
  buildInitialCollaborationTemplates,
  collaborationTemplateAsSection,
} from '../../shared/collaboration-templates'
import {
  POST_RAG_RETRIEVAL_INDEX_VERSION,
  buildPostRagSourceProjection,
  isPostEligibleForTrustedRag,
  isPostRagSourceProjectionValidationError,
  PostRagSourceProjectionValidationError,
} from '../post-rag-indexing'

const section = (overrides: Partial<Section> = {}): Section => ({
  _id: 'section-1', communityId: 'community-1', name: '社区课堂', icon: 'class', order: 1,
  enableComment: true, enableLike: true, createdAt: '2026-07-01T00:00:00.000Z', type: 'evergreen', status: 'active',
  widgets: [
    { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
    { widgetId: 'body', type: 'rich_text', label: '正文', fieldKey: 'body', required: false, order: 1, showInList: false, visibility: 'member' },
  ],
  ...overrides,
})

const post = (overrides: Partial<Post> = {}): Post => ({
  _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', authorId: 'author-1',
  status: 'active', auditStatus: 'pass', content: { title: '第一课', body: '<p>一粥一饭，当思来处不易。</p>' },
  commentCount: 0, likeCount: 0, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
  ...overrides,
})

describe('trusted RAG source projection', () => {
  test('projection validation error has immutable authenticated policy fields', () => {
    const error = new PostRagSourceProjectionValidationError()
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
    expect(() => { (error as any).retryable = true }).toThrow()
    expect(isPostRagSourceProjectionValidationError(Object.create(PostRagSourceProjectionValidationError.prototype))).toBe(false)
    expect(isPostRagSourceProjectionValidationError(error)).toBe(true)
  })
  test('uses the versioned retrieval contract and stable hashes independent of object key order', () => {
    const first = buildPostRagSourceProjection(post(), section())
    const reorderedPost = { ...post(), content: { body: '<p>一粥一饭，当思来处不易。</p>', title: '第一课' } }
    const reorderedSection = { ...section(), widgets: [...section().widgets].map((widget) => ({ ...widget })).reverse().reverse() }
    const second = buildPostRagSourceProjection(reorderedPost, reorderedSection)
    expect(first.retrievalIndexVersion).toBe(POST_RAG_RETRIEVAL_INDEX_VERSION)
    expect(first.sourceVersion).toBe(second.sourceVersion)
    expect(first.chunkChecksum).toBe(second.chunkChecksum)
  })

  test('changes source and chunk identities when the retrieval index version changes', () => {
    const first = buildPostRagSourceProjection(post(), section(), { retrievalIndexVersion: 'index-v1' })
    const second = buildPostRagSourceProjection(post(), section(), { retrievalIndexVersion: 'index-v2' })
    expect(first.sourceVersion).not.toBe(second.sourceVersion)
    expect(first.chunks.map((chunk) => chunk.chunkId)).not.toEqual(second.chunks.map((chunk) => chunk.chunkId))
  })

  test.each([
    ['content', post({ content: { title: '第二课', body: '<p>一粥一饭，当思来处不易。</p>' } }), section()],
    ['section name', post(), section({ name: '新课堂' })],
    ['widget label', post(), section({ widgets: section().widgets.map((w) => w.widgetId === 'body' ? { ...w, label: '详细正文' } : w) })],
    ['visibility', post(), section({ widgets: section().widgets.map((w) => w.widgetId === 'body' ? { ...w, visibility: 'public' } : w) })],
  ])('changes source version when %s changes', (_label, changedPost, changedSection) => {
    expect(buildPostRagSourceProjection(changedPost, changedSection).sourceVersion)
      .not.toBe(buildPostRagSourceProjection(post(), section()).sourceVersion)
  })

  test('requires active approved post and a matching active section', () => {
    expect(isPostEligibleForTrustedRag(post(), section())).toBe(true)
    expect(isPostEligibleForTrustedRag(post({ auditStatus: undefined }), section())).toBe(true)
    expect(isPostEligibleForTrustedRag(post({ status: 'deleted' }), section())).toBe(false)
    expect(isPostEligibleForTrustedRag(post({ auditStatus: 'pending' }), section())).toBe(false)
    expect(isPostEligibleForTrustedRag(post(), section({ status: 'archived' }))).toBe(false)
    expect(isPostEligibleForTrustedRag(post(), section({ communityId: 'other' }))).toBe(false)
    expect(isPostEligibleForTrustedRag(post(), null as any)).toBe(false)
  })

  test('projects a section-free archive post with topics through a virtual archive schema', () => {
    const archivePost = post({
      sectionId: '',
      area: 'archive',
      origin: 'native_archive',
      format: 'text',
      topics: ['亲子出游', '成长'],
      content: {
        title: '周末记录',
        body: { format: 'markdown', markdown: '一起去湖边', html: '<p>一起去湖边</p>', text: '一起去湖边', imageFileIDs: [], schemaVersion: 1 },
      },
    })

    const projection = buildPostRagSourceProjection(archivePost, null)

    expect(projection.eligible).toBe(true)
    expect(projection.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ postId: 'post-1', communityId: 'community-1', sectionId: '', sectionName: '沉淀区', text: expect.stringContaining('亲子出游') }),
      expect.objectContaining({ text: '一起去湖边' }),
    ]))
  })

  test('projects a section-free collaboration post through its global template schema', () => {
    const template = buildInitialCollaborationTemplates()[0]
    const collaborationPost = post({
      sectionId: '',
      area: 'collaboration',
      collaborationTemplateId: template._id,
      collaborationSystemKey: template.systemKey,
      content: {
        carpool_origin: '青山村东门',
        carpool_destination: '成都软件园',
        carpool_departure_time: '2026-07-16T08:30:00.000Z',
        carpool_location: { address: '青山村东门', lat: 30.1, lng: 104.1 },
        carpool_note: [{ blockId: 'note-1', type: 'text', text: '可带一件行李' }],
      },
    })
    const templateSection = collaborationTemplateAsSection(template, 'community-1')

    const projection = buildPostRagSourceProjection(collaborationPost, templateSection)

    expect(projection.eligible).toBe(true)
    expect(projection.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        postId: 'post-1',
        communityId: 'community-1',
        sectionId: '',
        sectionName: '拼车出行',
        text: '青山村东门',
      }),
      expect.objectContaining({ text: '可带一件行李' }),
    ]))
  })

  test('produces deterministic versioned chunks with exact metadata checksums', () => {
    const projection = buildPostRagSourceProjection(post(), section())
    const repeated = buildPostRagSourceProjection(post(), section())
    expect(projection.eligible).toBe(true)
    expect(projection.chunkCount).toBe(2)
    expect(projection.chunks).toEqual(repeated.chunks)
    expect(projection.chunks[1]).toMatchObject({
      postId: 'post-1', communityId: 'community-1', sectionId: 'section-1',
      sourceVersion: projection.sourceVersion,
      retrievalIndexVersion: POST_RAG_RETRIEVAL_INDEX_VERSION,
      widgetId: 'body', fieldKey: 'body', fieldLabel: '正文', fieldType: 'rich_text', visibility: 'member',
      title: '第一课', sectionName: '社区课堂', text: '一粥一饭，当思来处不易。', chunkIndex: 1,
    })
    expect(projection.chunks.every((chunk: { chunkChecksum: string }) => /^[a-f0-9]{64}$/.test(chunk.chunkChecksum))).toBe(true)
    expect(projection.chunks.every((chunk: { chunkId: string }) => /^prc_[a-f0-9]{64}$/.test(chunk.chunkId))).toBe(true)
    expect(projection.chunkChecksum).toMatch(/^[a-f0-9]{64}$/)
  })

  test('keeps widget identity when two widgets share a field key', () => {
    const duplicateSection = section({ widgets: [
      { ...section().widgets[0], widgetId: 'primary', fieldKey: 'shared', label: '主标题' },
      { ...section().widgets[0], widgetId: 'secondary', fieldKey: 'shared', label: '副标题', order: 1 },
    ] })
    const projection = buildPostRagSourceProjection(post({ content: { primary: '甲', secondary: '乙' } }), duplicateSection)
    expect(projection.chunks.map((chunk) => chunk.widgetId)).toEqual(['primary', 'secondary'])
    expect(new Set(projection.chunks.map((chunk) => chunk.chunkId)).size).toBe(2)
  })

  test('only projects standard post-search fields and excludes analysis caches', () => {
    const projection = buildPostRagSourceProjection(post({
      content: { title: '第一课', body: '正文', videoAnalysis: { ocr: '秘密OCR', asr: '秘密ASR' } } as any,
      videoAnalysis: { summary: '缓存摘要' },
    } as any), section())
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('秘密OCR')
    expect(serialized).not.toContain('秘密ASR')
    expect(serialized).not.toContain('缓存摘要')
  })

  test('returns a deterministic removal projection that changes with removal facts', () => {
    const removed = buildPostRagSourceProjection(post({ status: 'deleted' }), section())
    const review = buildPostRagSourceProjection(post({ auditStatus: 'pending' }), section())
    const missing = buildPostRagSourceProjection(post(), null as any)
    expect(removed).toMatchObject({ eligible: false, chunks: [], chunkCount: 0 })
    expect(removed.sourceVersion).toMatch(/^removed-[a-f0-9]{64}$/)
    expect(removed.chunkChecksum).toBe(missing.chunkChecksum)
    expect(new Set([removed.sourceVersion, review.sourceVersion, missing.sourceVersion]).size).toBe(3)
  })

  test.each([
    ['deleted', post({ status: 'deleted' })],
    ['pending audit', post({ auditStatus: 'pending' })],
  ])('ignores malformed searchable content for an ineligible %s post', (_label, ineligiblePost) => {
    const cyclic: any = {}; cyclic.self = cyclic
    ineligiblePost.content = { title: cyclic } as any
    expect(buildPostRagSourceProjection(ineligiblePost, section())).toMatchObject({ eligible: false, chunks: [] })
  })

  test('ignores malformed searchable content when the section is missing', () => {
    expect(buildPostRagSourceProjection(post({ content: { title: () => undefined } as any }), null as any))
      .toMatchObject({ eligible: false, chunks: [] })
  })

  test('still fails closed when removal facts themselves are malformed', () => {
    expect(() => buildPostRagSourceProjection(post({ _id: (() => undefined) as any, status: 'deleted' }), section()))
      .toThrow(/canonical/i)
  })

  test.each([
    ['function', () => undefined], ['symbol', Symbol('bad')], ['nonfinite', Number.POSITIVE_INFINITY],
  ])('fails closed on malformed %s projection values', (_label, malformed) => {
    expect(() => buildPostRagSourceProjection(post({ content: { title: malformed } as any }), section())).toThrow(/canonical/i)
  })

  test('fails closed on cyclic projection values', () => {
    const cyclic: any = {}; cyclic.self = cyclic
    expect(() => buildPostRagSourceProjection(post({ content: { title: cyclic } as any }), section())).toThrow(/canonical/i)
  })

  test('fails closed on symbol-keyed canonical values', () => {
    const title: any = { text: 'visible' }; title[Symbol('hidden')] = 'unstable'
    expect(() => buildPostRagSourceProjection(post({ content: { title } as any }), section())).toThrow(/canonical/i)
  })

  test('does not silently lose an enumerable own __proto__ canonical key', () => {
    const title: any = { text: 'visible' }
    Object.defineProperty(title, '__proto__', { value: 'hidden-fact', enumerable: true })
    expect(() => buildPostRagSourceProjection(post({ content: { title } as any }), section())).toThrow(/canonical/i)
  })

  test('rejects an accessor without executing its getter', () => {
    let getterCalls = 0
    const title: any = {}
    Object.defineProperty(title, 'text', {
      enumerable: true,
      get() { getterCalls += 1; return 'time-dependent' },
    })
    expect(() => buildPostRagSourceProjection(post({ content: { title } as any }), section())).toThrow(/canonical/i)
    expect(getterCalls).toBe(0)
  })

  test.each(['post', 'section'])('rejects a top-level %s accessor before eligibility reads it', (target) => {
    let getterCalls = 0
    const candidatePost: any = post()
    const candidateSection: any = section()
    Object.defineProperty(target === 'post' ? candidatePost : candidateSection, 'status', {
      enumerable: true,
      get() { getterCalls += 1; return 'active' },
    })
    expect(() => buildPostRagSourceProjection(candidatePost, candidateSection)).toThrow(/canonical/i)
    expect(getterCalls).toBe(0)
  })

  test.each(['content field', 'widget field'])('rejects a nested %s accessor without executing it', (target) => {
    let getterCalls = 0
    const candidatePost: any = post()
    const candidateSection: any = section()
    const owner = target === 'content field' ? candidatePost.content : candidateSection.widgets[0]
    const key = target === 'content field' ? 'title' : 'label'
    Object.defineProperty(owner, key, {
      enumerable: true,
      get() { getterCalls += 1; return 'time-dependent' },
    })
    expect(() => buildPostRagSourceProjection(candidatePost, candidateSection)).toThrow(/canonical/i)
    expect(getterCalls).toBe(0)
  })

  test.each([
    ['custom prototype', Object.assign(Object.create({ inherited: true }), { text: '第一课' })],
    ['class instance', new (class SearchValue { text = '第一课' })()],
  ])('rejects a %s object', (_label, title) => {
    expect(() => buildPostRagSourceProjection(post({ content: { title } as any }), section())).toThrow(/canonical/i)
  })

  test('canonicalizes null-prototype plain data as stably as an ordinary object', () => {
    const body = Object.create(null) as Record<string, unknown>
    body.text = '相同正文'
    const richSection = section({ widgets: section().widgets.map((widget) =>
      widget.widgetId === 'body' ? { ...widget, type: 'rich_note' } : widget
    ) })
    expect(buildPostRagSourceProjection(post({ content: { title: '第一课', body } as any }), richSection).sourceVersion)
      .toBe(buildPostRagSourceProjection(post({ content: { title: '第一课', body: { text: '相同正文' } } as any }), richSection).sourceVersion)
  })

  test('normalizes Date values to their ISO representation', () => {
    const withDate = post({ updatedAt: new Date('2026-07-02T00:00:00.000Z') as any })
    expect(buildPostRagSourceProjection(withDate, section()).sourceVersion)
      .toBe(buildPostRagSourceProjection(post(), section()).sourceVersion)
  })
})
