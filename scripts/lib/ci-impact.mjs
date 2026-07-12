const OUTPUT_KEYS = ['full', 'install', 'cloud', 'admin', 'miniprogram', 'deployOutput', 'docs', 'governance', 'releasePlan']

function blankImpact() {
  return Object.fromEntries(OUTPUT_KEYS.map((key) => [key, key === 'install']))
}

function expandFull(impact) {
  for (const key of OUTPUT_KEYS) impact[key] = true
  return impact
}

function isDocumentation(path) {
  return path.startsWith('docs/') || /^[^/]+\.md$/i.test(path)
}

export function classifyChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('Cannot classify an empty diff')
  const impact = blankImpact()

  for (const change of changes) {
    if (change.binary || change.status === 'D' || /^[RC]/.test(change.status)) return expandFull(impact)
    const path = change.path.replaceAll('\\', '/')
    if (path === 'package.json' || path === 'package-lock.json' || path.startsWith('.github/') || path.startsWith('scripts/')) return expandFull(impact)
    if (isDocumentation(path)) {
      impact.docs = true
      impact.governance = true
    } else if (path.startsWith('cloud/shared/')) {
      impact.cloud = true
      impact.admin = true
      impact.miniprogram = true
      impact.releasePlan = true
    } else if (path.startsWith('cloud/')) {
      impact.cloud = true
      impact.releasePlan = true
    } else if (path.startsWith('admin-web/')) {
      impact.admin = true
      impact.releasePlan = true
    } else if (path.startsWith('miniprogram/')) {
      impact.miniprogram = true
      impact.releasePlan = true
    } else {
      return expandFull(impact)
    }
  }
  return impact
}

function nulFields(buffer) {
  const fields = buffer.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  return fields
}

export function parseNameStatusBuffer(buffer) {
  const fields = nulFields(buffer)
  const changes = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!status) throw new Error('Malformed empty git name-status record')
    if (/^[RC]/.test(status)) {
      if (index + 1 >= fields.length) throw new Error(`Malformed git name-status ${status} record`)
      changes.push({ status, oldPath: fields[index++], path: fields[index++] })
    } else {
      if (index >= fields.length) throw new Error(`Malformed git name-status ${status} record`)
      changes.push({ status, path: fields[index++] })
    }
  }
  return changes
}

export function parseNumstatBuffer(buffer, changes) {
  const changesByPath = new Map()
  for (const change of changes) {
    changesByPath.set(change.path, change)
    if (change.oldPath) changesByPath.set(change.oldPath, change)
  }
  for (const record of nulFields(buffer)) {
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) throw new Error('Malformed git numstat record')
    const added = record.slice(0, firstTab)
    const deleted = record.slice(firstTab + 1, secondTab)
    const path = record.slice(secondTab + 1)
    if (added === '-' && deleted === '-') {
      const change = changesByPath.get(path)
      if (!change) throw new Error(`Binary numstat path missing from name-status: ${JSON.stringify(path)}`)
      change.binary = true
    }
  }
  return changes
}

export { OUTPUT_KEYS }
