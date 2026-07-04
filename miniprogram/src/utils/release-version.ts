import { BUILD_INFO } from '../generated/build-info'

export function getReleaseVersion(): string {
  return String(BUILD_INFO.version || '').trim()
}
