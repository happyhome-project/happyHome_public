// Scenario 1: user login — new user creation + returning user update.

import { callAs, createAsserter, makeRunId } from './_shared.mjs'

const { assert, finish } = createAsserter('login')
const runId = makeRunId()
const openid = `scene-login-${runId}`

console.log(`Scenario: login (openid=${openid})`)

// First login: new user
const first = await callAs(openid, 'user', 'login', { nickName: 'LoginTest', avatarUrl: '' })
assert(first.isNew === true, 'first call creates a new user')
assert(first.user._id === openid, 'user._id matches injected openid')
assert(first.user.role === 'user', 'default role is "user"')

// Second login: same user, updated profile
const second = await callAs(openid, 'user', 'login', { nickName: 'LoginTestRenamed', avatarUrl: 'https://x/a.png' })
assert(second.isNew === false, 'second call recognizes existing user')
assert(second.user.nickName === 'LoginTestRenamed', 'nickName updated')
assert(second.user.avatarUrl === 'https://x/a.png', 'avatarUrl updated')

finish()
