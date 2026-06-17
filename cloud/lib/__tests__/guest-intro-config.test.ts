jest.mock('../db', () => ({
  query: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
}))

import * as db from '../db'
import { DEFAULT_GUEST_INTRO_CONFIG, GUEST_INTRO_CONFIG_KEY } from '../../shared/guest-intro-config'
import { getGuestIntroConfig, saveGuestIntroConfig } from '../guest-intro-config'

beforeEach(() => {
  jest.resetAllMocks()
})

describe('guest intro config storage', () => {
  test('returns default config when the app config document is missing', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([])

    const config = await getGuestIntroConfig()

    expect(db.query).toHaveBeenCalledWith('app_configs', { key: GUEST_INTRO_CONFIG_KEY }, { limit: 1 })
    expect(config).toEqual(DEFAULT_GUEST_INTRO_CONFIG)
  })

  test('returns default config when the app config collection is not provisioned yet', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('CollectionNotExists'))

    await expect(getGuestIntroConfig()).resolves.toEqual(DEFAULT_GUEST_INTRO_CONFIG)
  })

  test('updates an existing config without changing version for ordinary saves', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([
      {
        _id: 'doc-1',
        key: GUEST_INTRO_CONFIG_KEY,
        ...DEFAULT_GUEST_INTRO_CONFIG,
        version: 'intro-v1',
      },
    ])
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const config = await saveGuestIntroConfig(
      { title: '  新标题  ' },
      { publishNewVersion: false, now: '2026-06-17T08:00:00.000Z', updatedBy: 'boss' },
    )

    expect(config.version).toBe('intro-v1')
    expect(config.title).toBe('新标题')
    expect(db.updateById).toHaveBeenCalledWith(
      'app_configs',
      'doc-1',
      expect.objectContaining({
        key: GUEST_INTRO_CONFIG_KEY,
        version: 'intro-v1',
        title: '新标题',
        updatedBy: 'boss',
      }),
    )
    expect(db.create).not.toHaveBeenCalled()
  })

  test('creates the config document and bumps version when publishing a new version', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([])
    ;(db.create as jest.Mock).mockResolvedValue('doc-new')

    const config = await saveGuestIntroConfig(
      { body: '  新正文  ' },
      { publishNewVersion: true, now: '2026-06-17T08:00:00.000Z', updatedBy: 'boss' },
    )

    expect(config.version).toBe('guest-intro-2026-06-17T08:00:00.000Z')
    expect(config.body).toBe('新正文')
    expect(db.create).toHaveBeenCalledWith(
      'app_configs',
      expect.objectContaining({
        key: GUEST_INTRO_CONFIG_KEY,
        version: 'guest-intro-2026-06-17T08:00:00.000Z',
        body: '新正文',
        updatedBy: 'boss',
      }),
    )
  })
})
