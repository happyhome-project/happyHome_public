import {
  DEFAULT_GUEST_INTRO_CONFIG,
  buildGuestIntroConfigForSave,
  normalizeGuestIntroConfig,
} from '../guest-intro-config'

describe('guest intro config', () => {
  test('normalizes an empty config to the B1-a default copy', () => {
    const config = normalizeGuestIntroConfig(null)

    expect(config.enabled).toBe(true)
    expect(config.title).toBe('以后社群里的事，可以从这里找')
    expect(config.body).toContain('青山村样板')
    expect(config.body).toContain('自己的社群')
    expect(config.features).toEqual([
      { key: 'recent', label: '看最近', text: '通知、活动、课程安排' },
      { key: 'materials', label: '找资料', text: '就医、出行、电话和地点' },
      { key: 'history', label: '翻历史', text: '以前整理过的有用内容' },
    ])
    expect(config.primaryActionText).toBe('先看看样板')
    expect(config.secondaryActionText).toBe('登录后加入或创建社群')
  })

  test('trims editable fields and fills missing feature rows from defaults', () => {
    const config = normalizeGuestIntroConfig({
      enabled: false,
      version: ' custom-v1 ',
      title: '  新标题  ',
      body: '  新正文  ',
      features: [
        { key: 'recent', label: ' 最近 ', text: ' 本周信息 ' },
      ],
      primaryActionText: '  继续看  ',
      secondaryActionText: '  去加入  ',
    })

    expect(config.enabled).toBe(false)
    expect(config.version).toBe('custom-v1')
    expect(config.title).toBe('新标题')
    expect(config.body).toBe('新正文')
    expect(config.features[0]).toEqual({ key: 'recent', label: '最近', text: '本周信息' })
    expect(config.features[1]).toEqual(DEFAULT_GUEST_INTRO_CONFIG.features[1])
    expect(config.features[2]).toEqual(DEFAULT_GUEST_INTRO_CONFIG.features[2])
    expect(config.primaryActionText).toBe('继续看')
    expect(config.secondaryActionText).toBe('去加入')
  })

  test('saving copy keeps the current version unless publishNewVersion is requested', () => {
    const current = normalizeGuestIntroConfig({
      ...DEFAULT_GUEST_INTRO_CONFIG,
      version: 'intro-v1',
    })
    const saved = buildGuestIntroConfigForSave(
      { title: '  改个标题  ' },
      current,
      { publishNewVersion: false, now: '2026-06-17T08:00:00.000Z', updatedBy: 'boss' },
    )
    const published = buildGuestIntroConfigForSave(
      { title: '  改个标题  ' },
      current,
      { publishNewVersion: true, now: '2026-06-17T08:00:00.000Z', updatedBy: 'boss' },
    )

    expect(saved.version).toBe('intro-v1')
    expect(saved.updatedAt).toBe('2026-06-17T08:00:00.000Z')
    expect(saved.updatedBy).toBe('boss')
    expect(published.version).toBe('guest-intro-2026-06-17T08:00:00.000Z')
  })
})
