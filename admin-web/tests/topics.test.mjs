import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const topicsSource = path.join(adminRoot, 'src', 'utils', 'topics.ts')

async function loadTopicsModule() {
  assert.equal(existsSync(topicsSource), true, '话题规范化工具尚未实现')
  const source = readFileSync(topicsSource, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: topicsSource,
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
  return import(moduleUrl)
}

test('话题会做 NFKC、去井号和不区分大小写去重', async () => {
  const { validateAndNormalizeTopics } = await loadTopicsModule()
  assert.deepEqual(validateAndNormalizeTopics([' ＃亲子出游 ', '#ＡＢＣ', 'abc']), {
    ok: true,
    topics: ['亲子出游', 'ABC'],
  })
})

test('话题长度按 Unicode 字符计算，最多 20 个字符', async () => {
  const { validateAndNormalizeTopics } = await loadTopicsModule()
  assert.deepEqual(validateAndNormalizeTopics(['😀'.repeat(20)]), {
    ok: true,
    topics: ['😀'.repeat(20)],
  })
  assert.deepEqual(validateAndNormalizeTopics(['😀'.repeat(21)]), {
    ok: false,
    message: '每个话题最多 20 个字符',
  })
})

test('话题最多保留五个唯一值', async () => {
  const { validateAndNormalizeTopics } = await loadTopicsModule()
  assert.deepEqual(validateAndNormalizeTopics(['一', '二', '三', '四', '五', '六']), {
    ok: false,
    message: '最多添加 5 个话题',
  })
})

test('追加重复话题不会产生第二个标签', async () => {
  const { appendTopic } = await loadTopicsModule()
  assert.deepEqual(appendTopic(['亲子出游'], '#亲子出游'), {
    ok: true,
    topics: ['亲子出游'],
    duplicate: true,
  })
})
