import { describe, expect, test } from 'vitest'
import { createProfileEditSessionGuard, resolveProfileAvatarUrl } from '../profile-edit-session'

describe('profile edit session guard', () => {
  test('blocks close and reopen while saving and rejects an old completion after a new generation starts', () => {
    const guard = createProfileEditSessionGuard()
    const firstGeneration = guard.tryStart(false)

    expect(firstGeneration).not.toBeNull()
    expect(guard.requestClose(true)).toBe(false)
    expect(guard.tryStart(true)).toBeNull()
    expect(guard.tryStart(false)).toBeNull()
    expect(guard.isCurrent(firstGeneration!)).toBe(true)

    expect(guard.requestClose(false)).toBe(true)
    const secondGeneration = guard.tryStart(false)
    expect(secondGeneration).not.toBeNull()
    expect(guard.complete(firstGeneration!)).toBe(false)
    expect(guard.isCurrent(secondGeneration!)).toBe(true)
    expect(guard.complete(secondGeneration!)).toBe(true)
  })
})

describe('profile avatar resolution', () => {
  test('keeps the existing avatar without uploading when no replacement was selected', async () => {
    let uploads = 0
    const avatarUrl = await resolveProfileAvatarUrl({
      selectedTempPath: '',
      existingAvatarUrl: 'cloud://existing-avatar',
      uploadSelectedAvatar: async () => {
        uploads += 1
        return { fileID: 'cloud://unexpected' }
      },
    })

    expect(avatarUrl).toBe('cloud://existing-avatar')
    expect(uploads).toBe(0)
  })

  test('uses the uploaded file id when a replacement was selected', async () => {
    const avatarUrl = await resolveProfileAvatarUrl({
      selectedTempPath: 'wxfile://replacement.jpg',
      existingAvatarUrl: 'cloud://existing-avatar',
      uploadSelectedAvatar: async (source) => {
        expect(source).toBe('wxfile://replacement.jpg')
        return { fileID: 'cloud://replacement-avatar' }
      },
    })

    expect(avatarUrl).toBe('cloud://replacement-avatar')
  })

  test('rejects upload failures and empty file ids instead of replacing the existing avatar', async () => {
    await expect(resolveProfileAvatarUrl({
      selectedTempPath: 'wxfile://replacement.jpg',
      existingAvatarUrl: 'cloud://existing-avatar',
      uploadSelectedAvatar: async () => { throw new Error('network failed') },
    })).rejects.toThrow('network failed')

    await expect(resolveProfileAvatarUrl({
      selectedTempPath: 'wxfile://replacement.jpg',
      existingAvatarUrl: 'cloud://existing-avatar',
      uploadSelectedAvatar: async () => ({ fileID: '' }),
    })).rejects.toThrow('头像上传失败')
  })
})
