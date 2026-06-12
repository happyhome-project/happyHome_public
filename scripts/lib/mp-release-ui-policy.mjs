export const REQUIRED_RELEASE_UI_MARKERS = [
  {
    id: 'home-detail-nonempty',
    marker: 'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    description: 'home feed tap opens a non-empty detail page',
  },
  {
    id: 'login-page-version',
    marker: 'HH_RELEASE_LOGIN_VERSION',
    description: 'logged-out login/profile page renders and shows the build version',
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
  if (!evidence.homeDetailNonEmpty) missing.push(REQUIRED_RELEASE_UI_MARKERS[0])
  if (!evidence.loginVersionVisible) missing.push(REQUIRED_RELEASE_UI_MARKERS[1])
  if (!evidence.profileLoginClean) missing.push(REQUIRED_RELEASE_UI_MARKERS[2])
  if (missing.length) {
    const details = missing.map(({ marker, description }) => `${marker} (${description})`).join(', ')
    throw new Error(`Release UI evidence markers missing: ${details}`)
  }
}
