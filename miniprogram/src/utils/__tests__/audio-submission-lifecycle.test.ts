import { describe, expect, test } from 'vitest'
import * as audioPublish from '../audio-publish'

type SubmissionOwnership = {
  claimForSubmission(): boolean
  isSubmissionOwned(): boolean
  isMutationLocked(): boolean
  handleUnmount(): Promise<void>
  settleAfterSubmission(outcome: 'accepted' | 'retry'): Promise<void>
}

const createOwnership = (cleanup: () => Promise<void>): SubmissionOwnership => (
  (audioPublish as any).createAudioSubmissionOwnership(cleanup)
)

describe('audio submission pending-file ownership', () => {
  test('blocks page navigation while ready audio is being materialized by the server', () => {
    const shouldBlock = (audioPublish as any).shouldBlockAudioPageNavigation
    expect(shouldBlock({ editorBlocked: false, submissionInFlight: true })).toBe(true)
    expect(shouldBlock({ editorBlocked: false, submissionInFlight: false })).toBe(false)
  })

  test('does not delete server-owned pending sources on unmount and cleans them after a failed request settles', async () => {
    const events: string[] = []
    const ownership = createOwnership(async () => { events.push('cleanup') })

    expect(ownership.claimForSubmission()).toBe(true)
    expect(ownership.isSubmissionOwned()).toBe(true)
    await ownership.handleUnmount()
    expect(events).toEqual([])

    await ownership.settleAfterSubmission('retry')
    expect(events).toEqual(['cleanup'])
    expect(ownership.isSubmissionOwned()).toBe(false)
  })

  test('returns rejected submissions to the mounted editor without deleting retryable sources', async () => {
    const events: string[] = []
    const ownership = createOwnership(async () => { events.push('cleanup') })

    expect(ownership.claimForSubmission()).toBe(true)
    await ownership.settleAfterSubmission('retry')

    expect(events).toEqual([])
    expect(ownership.isSubmissionOwned()).toBe(false)
    expect(ownership.claimForSubmission()).toBe(true)
  })

  test('keeps ownership claimed until accepted cleanup settles and never rejects on cleanup failure', async () => {
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve })
    const ownership = createOwnership(() => cleanupGate)
    expect(ownership.claimForSubmission()).toBe(true)

    const settling = ownership.settleAfterSubmission('accepted')
    expect(ownership.isSubmissionOwned()).toBe(true)
    releaseCleanup()
    await settling
    expect(ownership.isSubmissionOwned()).toBe(false)

    const failure = createOwnership(async () => { throw new Error('cleanup unavailable') })
    expect(failure.claimForSubmission()).toBe(true)
    await expect(failure.settleAfterSubmission('accepted')).resolves.toBeUndefined()
    expect(failure.isSubmissionOwned()).toBe(false)
  })

  test('freezes direct handlers and late chooser callbacks until retry settlement restores editing', async () => {
    const model = ['ready-track']
    const cleanupEvents: string[] = []
    const ownership = createOwnership(async () => { cleanupEvents.push('cleanup') })
    const removeHandler = () => {
      if (ownership.isMutationLocked()) return
      model.splice(0, 1)
      cleanupEvents.push('remove-cleanup')
    }
    const lateChooserCallback = () => {
      if (ownership.isMutationLocked()) return
      model.push('late-track')
    }

    expect(ownership.claimForSubmission()).toBe(true)
    removeHandler()
    lateChooserCallback()
    expect(model).toEqual(['ready-track'])
    expect(cleanupEvents).toEqual([])

    await ownership.settleAfterSubmission('retry')
    expect(ownership.isMutationLocked()).toBe(false)
    removeHandler()
    lateChooserCallback()
    expect(model).toEqual(['late-track'])
    expect(cleanupEvents).toEqual(['remove-cleanup'])
  })
})
