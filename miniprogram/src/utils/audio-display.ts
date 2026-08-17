import type { AudioTrack } from '../../../cloud/shared/types'

export const DEFAULT_AUDIO_COVER = '/static/audio/default-audio-cover.jpg'

export type AudioTrackDisplaySummary = {
  tracks: AudioTrack[]
  firstCover: string
  trackCount: number
  totalDuration: number
}

export type AudioPlayerTrack = {
  fileID: string
  title: string
  duration: number
  cover?: string
}

export function summarizeAudioTracks(value: unknown): AudioTrackDisplaySummary {
  const tracks = Array.isArray(value)
    ? value.filter((item): item is AudioTrack => Boolean(item && typeof item === 'object'))
    : []
  const firstCover = tracks
    .map(track => String(track.cover || '').trim())
    .find(Boolean) || ''
  const totalDuration = tracks.reduce((total, track) => {
    const duration = Number(track.duration)
    return Number.isFinite(duration) && duration > 0 ? total + duration : total
  }, 0)
  return {
    tracks,
    firstCover,
    trackCount: tracks.length,
    totalDuration,
  }
}

export function formatAudioDuration(value: unknown): string {
  const parsed = Number(value)
  const totalSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const minuteText = String(minutes).padStart(2, '0')
  const secondText = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`
}

export function toAudioPlayerTracks(value: unknown): AudioPlayerTrack[] {
  return summarizeAudioTracks(value).tracks
    .map((track) => {
      const fileID = String(track.fileID || '').trim()
      const title = String(track.title || '').trim()
      const duration = Number(track.duration)
      const cover = String(track.cover || '').trim()
      return {
        fileID,
        title,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        ...(cover ? { cover } : {}),
      }
    })
    .filter(track => Boolean(track.fileID))
}

export function collectAudioCoverSources(value: unknown): string[] {
  const sources: string[] = []
  toAudioPlayerTracks(value).forEach((track) => {
    const cover = String(track.cover || '').trim()
    if (cover.startsWith('cloud://') && !sources.includes(cover)) sources.push(cover)
  })
  return sources
}

function resolvedDisplayCover(source: unknown, resolved: Record<string, string>): string {
  const canonical = String(source || '').trim()
  if (!canonical) return ''
  const candidate = String(resolved[canonical] || '').trim()
  if (!canonical.startsWith('cloud://')) return candidate || canonical
  return candidate && !candidate.startsWith('cloud://') ? candidate : ''
}

export function resolveAudioDisplayCover(
  currentTrack: AudioPlayerTrack | null | undefined,
  tracks: AudioPlayerTrack[],
  resolved: Record<string, string>,
): string {
  const current = resolvedDisplayCover(currentTrack?.cover, resolved)
  if (current) return current
  for (const track of tracks) {
    const cover = resolvedDisplayCover(track.cover, resolved)
    if (cover) return cover
  }
  return DEFAULT_AUDIO_COVER
}
