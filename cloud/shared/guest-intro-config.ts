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
  version: 'guest-intro-default-v1',
  title: '以后社群里的事，可以从这里找',
  body: '你现在看到的是青山村样板。加入自己的社群后，通知、活动、就医、出行和历史资料，都会沉淀在这里。',
  features: [
    { key: 'recent', label: '看最近', text: '通知、活动、课程安排' },
    { key: 'materials', label: '找资料', text: '就医、出行、电话和地点' },
    { key: 'history', label: '翻历史', text: '以前整理过的有用内容' },
  ],
  primaryActionText: '先看看样板',
  secondaryActionText: '登录后加入或创建社群',
}

function textOrDefault(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
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
  const rawFeatures = Array.isArray(raw.features) ? raw.features : []
  const features = DEFAULT_GUEST_INTRO_CONFIG.features.map((fallback, index) =>
    normalizeFeature(rawFeatures[index], fallback)
  )

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_GUEST_INTRO_CONFIG.enabled,
    version: textOrDefault(raw.version, DEFAULT_GUEST_INTRO_CONFIG.version),
    title: textOrDefault(raw.title, DEFAULT_GUEST_INTRO_CONFIG.title),
    body: textOrDefault(raw.body, DEFAULT_GUEST_INTRO_CONFIG.body),
    features,
    primaryActionText: textOrDefault(raw.primaryActionText, DEFAULT_GUEST_INTRO_CONFIG.primaryActionText),
    secondaryActionText: textOrDefault(raw.secondaryActionText, DEFAULT_GUEST_INTRO_CONFIG.secondaryActionText),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
    ...(raw.updatedBy ? { updatedBy: String(raw.updatedBy) } : {}),
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
