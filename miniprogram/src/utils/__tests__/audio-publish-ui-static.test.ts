import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const srcRoot = resolve(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(resolve(srcRoot, ...parts), 'utf8')

describe('native archive audio publish UI contract', () => {
  test('uses a dedicated multi-track editor with real duration probing and scoped member uploads', () => {
    const editor = read('components', 'widgets', 'AudioPublishEditor.vue')
    expect(editor).toContain('multiple')
    expect(editor).toContain('.mp3,.m4a,.aac,.wav')
    expect(editor).toContain('chooseMessageFile')
    expect(editor).toContain('probeAudioDuration')
    expect(editor).toContain('new Audio')
    expect(editor).toContain('createInnerAudioContext')
    expect(editor).toContain('requestMemberAudioUpload')
    expect(editor).toContain('requestMemberAudioCoverUpload')
    expect(editor).toContain('deleteMemberAudioUpload')
    expect(editor).toContain('isAudioAsyncResultCurrent')
    expect(editor).toContain('finalizePendingUploadsAfterSubmit')
    expect(editor).toContain('onBeforeUnmount')
  })

  test('registers a newly uploaded stale fileID before immediately cleaning it', () => {
    const editor = read('components', 'widgets', 'AudioPublishEditor.vue')
    const audioUpload = editor.slice(editor.indexOf('async function uploadTrack'), editor.indexOf('async function uploadCover'))
    const remember = audioUpload.indexOf("rememberPendingUpload(result.fileID, 'audio')")
    const afterRemember = audioUpload.slice(remember)
    const staleCheck = afterRemember.indexOf('isAudioAsyncResultCurrent')
    const cleanup = afterRemember.indexOf('cleanupPendingUpload(result.fileID)')
    expect(remember).toBeGreaterThan(-1)
    expect(staleCheck).toBeGreaterThan(-1)
    expect(cleanup).toBeGreaterThan(staleCheck)
  })

  test('does not start queued audio work after the editor has unmounted', () => {
    const editor = read('components', 'widgets', 'AudioPublishEditor.vue')
    const audioUpload = editor.slice(editor.indexOf('async function uploadTrack'), editor.indexOf('async function uploadCover'))
    expect(audioUpload).toContain('if (!track || !track.source || unmounted) return')
  })

  test('builds only the ordered audios and required title widgets for native audio', () => {
    const create = read('pages', 'create', 'index.vue')
    const audioSectionStart = create.indexOf("if (format === 'audio')")
    const audioSectionEnd = create.indexOf("if (format === 'video')", audioSectionStart)
    const audioSection = create.slice(audioSectionStart, audioSectionEnd)
    expect(audioSectionStart).toBeGreaterThan(-1)
    expect(audioSection).toContain("fieldKey: 'audios'")
    expect(audioSection).toContain("type: 'audio_group'")
    expect(audioSection).toContain("fieldKey: 'title'")
    expect(audioSection.indexOf("fieldKey: 'audios'")).toBeLessThan(audioSection.indexOf("fieldKey: 'title'"))
    for (const forbidden of ['body', 'topics', 'location', 'route', 'distance', 'activity', 'recording', 'featureFlag']) {
      expect(audioSection).not.toContain(forbidden)
    }
    expect(create).toContain("archiveFormat === 'audio' && block.widget.type === 'audio_group'")
    expect(create).toContain('<AudioPublishEditor')
  })

  test('consumes direct and inline deferred audio intents once and hydrates audio edits', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('consumeDeferredArchiveAudioIntent')
    expect(create).toContain('consumeArchiveMediaIntent(token)')
    expect(create).toContain("currentPost.format === 'audio' ? 'audio'")
    expect(create).toContain("if (format === 'audio')")
    expect(create).toContain("archiveFormat.value === 'audio'")
    const consume = create.slice(
      create.indexOf('function consumeDeferredArchiveAudioIntent'),
      create.indexOf('function hasArchiveMedia'),
    )
    const defer = create.slice(
      create.indexOf('function deferArchiveAudioIntent'),
      create.indexOf('function consumeDeferredArchiveAudioIntent'),
    )
    expect(defer).toMatch(/if \(!intent\) \{[\s\S]*discardArchiveMediaIntent\(token\)[\s\S]*return false/)
    expect(consume.indexOf("pendingArchiveAudioIntentToken.value = ''")).toBeLessThan(
      consume.indexOf('consumeArchiveMediaIntent(token)'),
    )
    expect(create).toContain('discardArchiveMediaIntent(pendingArchiveAudioIntentToken.value)')
  })

  test('does not overwrite the current editor format before image or video to audio confirmation', () => {
    const create = read('pages', 'create', 'index.vue')
    const defer = create.slice(create.indexOf('function deferArchiveAudioIntent'), create.indexOf('function consumeDeferredArchiveAudioIntent'))
    expect(defer).not.toContain('archiveFormat.value')
    const inline = create.slice(create.indexOf('async function handleInlineMediaIntent'), create.indexOf('function restoreArchiveMediaEditor'))
    expect(inline).toContain('transitionArchiveMediaEditorState(currentState, intent.mediaType, null)')
    expect(inline).toContain("transition?.status === 'cancelled'")
    expect(inline).toContain('restoreArchiveMediaEditor()')
    expect(inline.indexOf("transition?.status === 'cancelled'")).toBeLessThan(inline.indexOf('enterArchiveEditor(nextFormat'))
  })

  test('refuses an inline format switch while audio duration, upload, or cover work is unresolved', () => {
    const create = read('pages', 'create', 'index.vue')
    const inline = create.slice(create.indexOf('async function handleInlineMediaIntent'), create.indexOf('function restoreArchiveMediaEditor'))
    const currentType = inline.indexOf('const currentType = currentPublishMediaType()')
    const block = inline.indexOf("currentType === 'audio' && audioNavigationBlocked.value")
    const transition = inline.indexOf('transitionArchiveMediaEditorState(currentState, intent.mediaType, null)')
    expect(block).toBeGreaterThan(currentType)
    expect(block).toBeLessThan(transition)
    expect(inline.slice(block, transition)).toContain('consumeArchiveMediaIntent(token)')
    expect(inline.slice(block, transition)).toContain('showAudioNavigationBlockedToast()')
  })

  test('does not save or restore audio drafts that would outlive pending-file cleanup', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('v-if="!isEditMode && archiveFormat !== \'audio\'"')
    expect(create).toContain("if (archiveFormat.value === 'audio') return")
    const restore = create.slice(create.indexOf('function restoreDraft()'), create.indexOf('function clearDraft()'))
    expect(restore).toContain("archiveFormat.value === 'audio'")
  })

  test('blocks submit and navigation until audio is ready, then hands pending ownership off before navigation', () => {
    const create = read('pages', 'create', 'index.vue')
    expect(create).toContain('@readiness="audioPublishReady = $event.ready"')
    expect(create).toContain('@navigation-blocked="audioNavigationBlocked = $event"')
    expect(create).toContain(':disabled="submitting || !videoPublishReady || !audioPublishReady"')
    expect(create).toContain("archiveFormat.value === 'audio' && !audioPublishReady.value")
    expect(create).toContain("archiveFormat.value === 'audio' && audioNavigationBlocked.value")
    const submit = create.slice(create.indexOf('async function handleSubmit()'), create.indexOf('</script>'))
    expect(submit).toContain('shouldCleanupPendingAudioAfterSubmit(result?.auditStatus)')
    expect(submit.indexOf('await audioEditorRef.value?.finalizePendingUploadsAfterSubmit()')).toBeGreaterThan(-1)
    expect(submit.indexOf('finalizePendingUploadsAfterSubmit')).toBeLessThan(submit.indexOf('handleEditSubmitResult'))
    const editor = read('components', 'widgets', 'AudioPublishEditor.vue')
    const finalize = editor.slice(editor.indexOf('async function finalizePendingUploadsAfterSubmit'), editor.indexOf('defineExpose'))
    expect(finalize).toContain('await cleanupPendingUploads()')
    expect(finalize).not.toContain('pendingUploads.clear()')
  })

  test('keeps the native audio editor free of unrelated post and travel controls', () => {
    const editor = read('components', 'widgets', 'AudioPublishEditor.vue')
    for (const forbidden of ['正文', '话题', '地点', '路线', '距离', '海拔', '爬升', '召集', '录音', 'featureFlag']) {
      expect(editor).not.toContain(forbidden)
    }
  })
})
