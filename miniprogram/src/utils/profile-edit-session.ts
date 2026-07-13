export interface ProfileAvatarUploadResult {
  fileID?: string | null
}

export interface ResolveProfileAvatarOptions {
  selectedTempPath: string
  existingAvatarUrl: string
  uploadSelectedAvatar: (source: string) => Promise<ProfileAvatarUploadResult>
}

export function createProfileEditSessionGuard() {
  let generation = 0
  let active = false

  return {
    tryStart(busy: boolean): number | null {
      if (busy || active) return null
      generation += 1
      active = true
      return generation
    },
    requestClose(busy: boolean): boolean {
      if (busy || !active) return false
      generation += 1
      active = false
      return true
    },
    isCurrent(candidate: number): boolean {
      return active && candidate === generation
    },
    complete(candidate: number): boolean {
      if (!active || candidate !== generation) return false
      generation += 1
      active = false
      return true
    },
  }
}

export async function resolveProfileAvatarUrl(options: ResolveProfileAvatarOptions): Promise<string> {
  if (!options.selectedTempPath) return options.existingAvatarUrl

  const result = await options.uploadSelectedAvatar(options.selectedTempPath)
  const uploadedFileId = String(result?.fileID || '').trim()
  if (!uploadedFileId) throw new Error('头像上传失败，请重试')
  return uploadedFileId
}
