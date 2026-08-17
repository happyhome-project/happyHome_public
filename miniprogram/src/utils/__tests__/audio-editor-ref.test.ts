import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { describe, expect, test } from 'vitest'
import * as audioPublish from '../audio-publish'

describe('audio editor exposed-instance resolution', () => {
  test('compiles the editor under v-for with a function ref instead of a ref array binding', () => {
    const filename = resolve(__dirname, '..', '..', 'pages', 'create', 'index.vue')
    const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
    const compiled = compileTemplate({
      source: descriptor.template?.content || '',
      filename,
      id: 'audio-editor-ref-contract',
    })

    expect(compiled.errors).toEqual([])
    expect(compiled.code).toContain('ref: _ctx.setAudioEditorRef')
    expect(compiled.code).not.toContain('ref: "audioEditorRef"')
  })

  test('resolves a callable exposed editor instance and fails closed without one', async () => {
    const requireHandle = (audioPublish as any).requireAudioPublishEditorSubmissionHandle
    const events: string[] = []
    const exposed = {
      claimPendingUploadsForSubmission: () => true,
      finalizePendingUploadsAfterSubmit: async () => { events.push('finalize') },
      returnPendingUploadsAfterSubmit: async () => { events.push('return') },
    }

    const resolved = requireHandle([null, {}, exposed])
    expect(resolved).toBe(exposed)
    expect(resolved.claimPendingUploadsForSubmission()).toBe(true)
    await resolved.finalizePendingUploadsAfterSubmit()
    expect(events).toEqual(['finalize'])
    expect(() => requireHandle([null, {}])).toThrow('音频编辑器')
  })
})
