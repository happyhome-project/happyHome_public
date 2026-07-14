export interface GuestIntroFeature {
  key: string
  label: string
  text: string
}

export interface GuestIntroConfig {
  enabled: boolean
  version: string
  title: string
  body: string
  features: GuestIntroFeature[]
  primaryActionText: string
  secondaryActionText: string
  updatedAt?: string
  updatedBy?: string
}

export interface GuestIntroSaveOptions {
  publishNewVersion?: boolean
  now?: string
  updatedBy?: string
}

export const GUEST_INTRO_CONFIG_KEY = 'guest_sample_intro'

export const DEFAULT_GUEST_INTRO_CONFIG: GuestIntroConfig = {
  enabled: true,
  version: 'guest-intro-default-v2',
  title: '「专属社群空间」',
  body: '在这里，与志同道合的邻居一起探索绿色生活方式，建设更美好的社区。',
  features: [
    { key: 'recent', label: '看最近', text: '通知、活动、课程安排' },
    { key: 'materials', label: '找资料', text: '就医、出行、电话和地点' },
    { key: 'history', label: '翻历史', text: '以前整理过的有用内容' },
  ],
  primaryActionText: '微信一键登录',
  secondaryActionText: '创建我自己的社群',
}

const LEGACY_DEFAULT_GUEST_INTRO_VERSIONS = new Set([
  'guest-intro-default-v1',
])
const LEGACY_DEFAULT_SECONDARY_ACTION_TEXT = '免费创建我的社群'

function textOrDefault(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function copyMetaFields(raw: Partial<GuestIntroConfig>): Partial<GuestIntroConfig> {
  return {
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
    ...(raw.updatedBy ? { updatedBy: String(raw.updatedBy) } : {}),
  }
}

function normalizeFeature(value: unknown, fallback: GuestIntroFeature): GuestIntroFeature {
  const raw = value && typeof value === 'object' ? value as Partial<GuestIntroFeature> : {}
  return {
    key: textOrDefault(raw.key, fallback.key),
    label: textOrDefault(raw.label, fallback.label),
    text: textOrDefault(raw.text, fallback.text),
  }
}

export function normalizeGuestIntroConfig(value: unknown): GuestIntroConfig {
  const raw = value && typeof value === 'object' ? value as Partial<GuestIntroConfig> : {}
  const version = textOrDefault(raw.version, DEFAULT_GUEST_INTRO_CONFIG.version)
  if (LEGACY_DEFAULT_GUEST_INTRO_VERSIONS.has(version)) {
    return {
      ...DEFAULT_GUEST_INTRO_CONFIG,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_GUEST_INTRO_CONFIG.enabled,
      ...copyMetaFields(raw),
    }
  }

  const rawFeatures = Array.isArray(raw.features) ? raw.features : []
  const features = DEFAULT_GUEST_INTRO_CONFIG.features.map((fallback, index) =>
    normalizeFeature(rawFeatures[index], fallback)
  )

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_GUEST_INTRO_CONFIG.enabled,
    version,
    title: textOrDefault(raw.title, DEFAULT_GUEST_INTRO_CONFIG.title),
    body: textOrDefault(raw.body, DEFAULT_GUEST_INTRO_CONFIG.body),
    features,
    primaryActionText: textOrDefault(raw.primaryActionText, DEFAULT_GUEST_INTRO_CONFIG.primaryActionText),
    secondaryActionText: textOrDefault(raw.secondaryActionText, DEFAULT_GUEST_INTRO_CONFIG.secondaryActionText) === LEGACY_DEFAULT_SECONDARY_ACTION_TEXT
      ? DEFAULT_GUEST_INTRO_CONFIG.secondaryActionText
      : textOrDefault(raw.secondaryActionText, DEFAULT_GUEST_INTRO_CONFIG.secondaryActionText),
    ...copyMetaFields(raw),
  }
}

export function buildGuestIntroConfigForSave(
  input: unknown,
  current: GuestIntroConfig = DEFAULT_GUEST_INTRO_CONFIG,
  options: GuestIntroSaveOptions = {},
): GuestIntroConfig {
  const now = options.now || new Date().toISOString()
  const normalizedCurrent = normalizeGuestIntroConfig(current)
  const merged = normalizeGuestIntroConfig({
    ...normalizedCurrent,
    ...(input && typeof input === 'object' ? input as Partial<GuestIntroConfig> : {}),
  })

  return {
    ...merged,
    version: options.publishNewVersion
      ? `guest-intro-${now}`
      : normalizedCurrent.version,
    updatedAt: now,
    ...(options.updatedBy ? { updatedBy: options.updatedBy } : {}),
  }
}
