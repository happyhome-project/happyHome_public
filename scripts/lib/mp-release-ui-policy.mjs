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

export function assertReleaseUiEvidence(evidence = {}) {
  const missing = []
  if (!evidence.homeDetailNonEmpty) missing.push(REQUIRED_RELEASE_UI_MARKERS[0])
  if (!evidence.loginVersionVisible) missing.push(REQUIRED_RELEASE_UI_MARKERS[1])
  if (missing.length) {
    const details = missing.map(({ marker, description }) => `${marker} (${description})`).join(', ')
    throw new Error(`Release UI evidence markers missing: ${details}`)
  }
}
