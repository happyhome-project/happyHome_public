export const REQUIRED_RELEASE_UI_MARKERS = [
  {
    id: 'home-cold-start-nonempty',
    marker: 'HH_RELEASE_HOME_COLD_START_NONEMPTY',
    description: 'cold-started home page registers and renders its custom shell',
  },
  {
    id: 'home-images-rendered',
    marker: 'HH_RELEASE_HOME_IMAGES_RENDERED',
    description: 'home page image evidence is satisfied for current content',
  },
  {
    id: 'home-archive-tabs-sticky',
    marker: 'HH_RELEASE_HOME_ARCHIVE_TABS_STICKY',
    description: 'one archive tabs control sticks while search scrolls away and archive switching stays stable',
  },
  {
    id: 'home-detail-nonempty',
    marker: 'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    description: 'home feed tap opens a non-empty detail page',
  },
  {
    id: 'login-page-version',
    marker: 'HH_RELEASE_LOGIN_VERSION',
    description: 'logged-out login/profile page exposes the build version through data-build-version without visible version text',
  },
  {
    id: 'profile-login-clean',
    marker: 'HH_RELEASE_PROFILE_LOGIN_CLEAN',
    description: 'logged-out profile login page renders without internal debug labels',
  },
]

export function buildDevToolsAutoArgs({ projectPath, idePort, autoPort }) {
  return [
    'auto',
    '--project', projectPath,
    '--port', String(idePort),
    '--auto-port', String(autoPort),
    '--trust-project',
  ]
}

export function assertColdStartDevToolsEnabled(env = process.env) {
  if (String(env.HH_RELEASE_UI_COLD_START_DEVTOOLS || '') === '0') {
    throw new Error('Release UI cold-start evidence must not be disabled.')
  }
}

export function buildDevToolsQuitArgs() {
  return ['quit']
}

export function buildDevToolsQuitPortArgs({ idePort }) {
  return ['quit', '--port', String(idePort)]
}

export function buildDevToolsCloseArgs({ projectPath, idePort }) {
  return [
    'close',
    '--project', projectPath,
    '--port', String(idePort),
  ]
}

export function buildDevToolsCacheArgs({ clean, projectPath, idePort }) {
  return [
    'cache',
    '--clean', clean,
    '--project', projectPath,
    '--port', String(idePort),
  ]
}

export function assertReleaseUiEvidence(evidence = {}) {
  const missing = []
  const loginBuildIdentityVerified = evidence.loginBuildIdentityVerified ?? evidence.loginVersionVisible
  if (!evidence.homeColdStartNonEmpty) missing.push(REQUIRED_RELEASE_UI_MARKERS[0])
  if (!evidence.homeImagesRendered) missing.push(REQUIRED_RELEASE_UI_MARKERS[1])
  if (!evidence.homeArchiveTabsSticky) missing.push(REQUIRED_RELEASE_UI_MARKERS[2])
  if (!evidence.homeDetailNonEmpty) missing.push(REQUIRED_RELEASE_UI_MARKERS[3])
  if (!loginBuildIdentityVerified) missing.push(REQUIRED_RELEASE_UI_MARKERS[4])
  if (!evidence.profileLoginClean) missing.push(REQUIRED_RELEASE_UI_MARKERS[5])
  if (missing.length) {
    const details = missing.map(({ marker, description }) => `${marker} (${description})`).join(', ')
    throw new Error(`Release UI evidence markers missing: ${details}`)
  }
}
