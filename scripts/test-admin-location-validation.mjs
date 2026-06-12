import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const repoRoot = process.cwd()
const require = createRequire(import.meta.url)
const ts = require(path.join(repoRoot, 'admin-web/node_modules/typescript'))

const sourcePath = path.join(repoRoot, 'admin-web/src/utils/locationValidation.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
  },
}).outputText

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
}
sandbox.exports = sandbox.module.exports
vm.runInNewContext(compiled, sandbox, { filename: sourcePath })

const {
  hasValidLocationCoordinate,
  isRequiredLocationComplete,
} = sandbox.module.exports

assert.equal(typeof hasValidLocationCoordinate, 'function', 'hasValidLocationCoordinate must be exported')
assert.equal(typeof isRequiredLocationComplete, 'function', 'isRequiredLocationComplete must be exported')

assert.equal(hasValidLocationCoordinate({ lat: 31.405678, lng: 104.133456 }), true)
assert.equal(hasValidLocationCoordinate({ lat: 0, lng: 0 }), false)
assert.equal(hasValidLocationCoordinate({ lat: 'abc', lng: 104.133456 }), false)
assert.equal(hasValidLocationCoordinate({ lat: 91, lng: 104.133456 }), false)

assert.equal(
  isRequiredLocationComplete({ address: '太平水库', lat: 0, lng: 0 }),
  false,
  'required location with only address and 0,0 coordinates must be incomplete',
)
assert.equal(
  isRequiredLocationComplete({ name: '太平水库', address: '四川省德阳市绵竹市太平水库', lat: 31.405678, lng: 104.133456 }),
  true,
)

console.log('admin location validation checks passed')
