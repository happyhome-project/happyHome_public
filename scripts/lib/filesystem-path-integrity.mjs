import { lstat, stat } from 'node:fs/promises'
import { join, parse, relative, resolve, sep } from 'node:path'

export async function assertNoSymbolicLinkPath(inputPath, message) {
  const absolutePath = resolve(inputPath)
  const root = parse(absolutePath).root
  const relativePath = relative(root, absolutePath)
  let current = root
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) throw new Error(message)
  }
  return absolutePath
}

export async function pathsReferToSameEntry(leftPath, rightPath) {
  let left
  let right
  try {
    [left, right] = await Promise.all([
      stat(leftPath, { bigint: true }),
      stat(rightPath, { bigint: true }),
    ])
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  return left.dev === right.dev && left.ino === right.ino
}
