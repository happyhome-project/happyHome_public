import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('does not use destructured watcher parameters in the create critical chunk', () => {
  const source = readFileSync(new URL('../index.vue', import.meta.url), 'utf8')

  expect(source).not.toContain('watch([selectedSection, textNoteStep], ([section, step])')
})
