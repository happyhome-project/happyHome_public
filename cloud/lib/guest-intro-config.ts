import * as db from './db'
import {
  DEFAULT_GUEST_INTRO_CONFIG,
  GUEST_INTRO_CONFIG_KEY,
  GuestIntroConfig,
  GuestIntroSaveOptions,
  buildGuestIntroConfigForSave,
  normalizeGuestIntroConfig,
} from '../shared/guest-intro-config'

const APP_CONFIGS_COLLECTION = 'app_configs'

interface GuestIntroConfigDoc extends GuestIntroConfig {
  _id?: string
  key?: string
}

async function getGuestIntroConfigDoc(): Promise<GuestIntroConfigDoc | null> {
  try {
    const rows = await db.query(APP_CONFIGS_COLLECTION, { key: GUEST_INTRO_CONFIG_KEY }, { limit: 1 })
    return (rows?.[0] as GuestIntroConfigDoc | undefined) || null
  } catch {
    return null
  }
}

export async function getGuestIntroConfig(): Promise<GuestIntroConfig> {
  const doc = await getGuestIntroConfigDoc()
  return doc ? normalizeGuestIntroConfig(doc) : DEFAULT_GUEST_INTRO_CONFIG
}

export async function saveGuestIntroConfig(
  input: unknown,
  options: GuestIntroSaveOptions = {},
): Promise<GuestIntroConfig> {
  const doc = await getGuestIntroConfigDoc()
  const current = doc ? normalizeGuestIntroConfig(doc) : DEFAULT_GUEST_INTRO_CONFIG
  const config = buildGuestIntroConfigForSave(input, current, options)
  const data = {
    key: GUEST_INTRO_CONFIG_KEY,
    ...config,
  }

  if (doc?._id) {
    await db.updateById(APP_CONFIGS_COLLECTION, doc._id, data)
  } else {
    await db.create(APP_CONFIGS_COLLECTION, data)
  }

  return config
}
