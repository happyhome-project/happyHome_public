export const REQUIRED_RELEASE_UI_MARKERS = [
  {
    id: 'home-detail-nonempty',
    marker: 'HH_RELEASE_HOME_DETAIL_NONEMPTY',
    description: 'home feed tap opens a non-empty detail page',
  },
  {
    id: 'profile-login-clean',
    marker: 'HH_RELEASE_PROFILE_LOGIN_CLEAN',
    description: 'logged-out profile login page renders without debug or version labels',
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
  if (!evidence.profileLoginClean) missing.push(REQUIRED_RELEASE_UI_MARKERS[1])
  if (missing.length) {
    const details = missing.map(({ marker, description }) => `${marker} (${description})`).join(', ')
    throw new Error(`Release UI evidence markers missing: ${details}`)
  }
}
