import assert from 'node:assert/strict';
import * as realFs from 'node:fs/promises';
import { mkdtemp, open, readFile, readdir, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  acquireValidationLease,
  inspectValidationLease,
  recoverValidationLease,
  withValidationLease,
} from './validation-lease.mjs';

const leasePath = (homeDir) => path.join(homeDir, '.happyhome', 'validation-lease.json');
const mutationLockPath = (homeDir) => path.join(homeDir, '.happyhome', 'validation-lease.mutation.lock');
const tempHome = () => mkdtemp(path.join(os.tmpdir(), 'happyhome-validation-lease-'));
const readLease = async (homeDir) => JSON.parse(await readFile(leasePath(homeDir), 'utf8'));
const ioError = (message) => Object.assign(new Error(message), { code: 'EIO' });

test('exclusive creation makes a second acquire fail atomically', async () => {
  const homeDir = await tempHome();
  const first = await acquireValidationLease({ command: 'first', homeDir });
  await assert.rejects(acquireValidationLease({ command: 'second', homeDir }), /already exists/i);
  await first.release();
});

test('lease mutations wait for the sibling mutation lock before touching state', async () => {
  const homeDir = await tempHome();
  const seed = await acquireValidationLease({ command: 'seed', homeDir });
  await seed.release();
  const blocker = await open(mutationLockPath(homeDir), 'wx');
  let settled = false;
  const pending = acquireValidationLease({ command: 'waiting', homeDir }).finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false);
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
  await blocker.close();
  await unlink(mutationLockPath(homeDir));
  const handle = await pending;
  assert.equal(handle.snapshot.command, 'waiting');
  await handle.release();
});

test('a fresh mutation lock fails with a bounded busy error', async () => {
  const homeDir = await tempHome();
  const seed = await acquireValidationLease({ command: 'seed', homeDir });
  await seed.release();
  const blocker = await open(mutationLockPath(homeDir), 'wx');
  await blocker.writeFile(JSON.stringify({ ownerToken: crypto.randomUUID(), acquiredAt: new Date().toISOString() }));
  await blocker.close();
  const startedAt = Date.now();
  await assert.rejects(acquireValidationLease({ command: 'blocked', homeDir }), /validation lease mutation busy/);
  assert.ok(Date.now() - startedAt < 1_000);
  await unlink(mutationLockPath(homeDir));
});

test('failed exclusive initialization writes close and remove only their artifacts', async (t) => {
  await t.test('mutation lock write failure', async () => {
    const homeDir = await tempHome();
    const failure = ioError('mutation write failed');
    let closed = false;
    const fileSystem = {
      ...realFs,
      async open(target, flags) {
        const handle = await realFs.open(target, flags);
        if (target !== mutationLockPath(homeDir)) return handle;
        return {
          writeFile: async () => { throw failure; },
          close: async () => { closed = true; await handle.close(); },
        };
      },
    };
    await assert.rejects(acquireValidationLease({ command: 'test', homeDir, fileSystem }), (error) => error === failure);
    assert.equal(closed, true);
    await assert.rejects(realFs.access(mutationLockPath(homeDir)), { code: 'ENOENT' });
  });

  await t.test('lease write failure', async () => {
    const homeDir = await tempHome();
    const failure = ioError('lease write failed');
    let closed = false;
    const fileSystem = {
      ...realFs,
      async open(target, flags) {
        const handle = await realFs.open(target, flags);
        if (target !== leasePath(homeDir)) return handle;
        return {
          writeFile: async () => { throw failure; },
          close: async () => { closed = true; await handle.close(); },
        };
      },
    };
    await assert.rejects(acquireValidationLease({ command: 'test', homeDir, fileSystem }), (error) => error === failure);
    assert.equal(closed, true);
    await assert.rejects(realFs.access(leasePath(homeDir)), { code: 'ENOENT' });
    await assert.rejects(realFs.access(mutationLockPath(homeDir)), { code: 'ENOENT' });
  });
});

test('close failures after successful exclusive writes remove owned artifacts', async (t) => {
  await t.test('mutation lock close failure', async () => {
    const homeDir = await tempHome();
    const failure = ioError('mutation close failed');
    const fileSystem = {
      ...realFs,
      async open(target, flags) {
        const handle = await realFs.open(target, flags);
        if (target !== mutationLockPath(homeDir)) return handle;
        return {
          writeFile: (...args) => handle.writeFile(...args),
          async close() { await handle.close(); throw failure; },
        };
      },
    };
    await assert.rejects(acquireValidationLease({ command: 'test', homeDir, fileSystem }), (error) => error === failure);
    await assert.rejects(realFs.access(mutationLockPath(homeDir)), { code: 'ENOENT' });
  });

  await t.test('lease close failure', async () => {
    const homeDir = await tempHome();
    const failure = ioError('lease close failed');
    const fileSystem = {
      ...realFs,
      async open(target, flags) {
        const handle = await realFs.open(target, flags);
        if (target !== leasePath(homeDir)) return handle;
        return {
          writeFile: (...args) => handle.writeFile(...args),
          async close() { await handle.close(); throw failure; },
        };
      },
    };
    await assert.rejects(acquireValidationLease({ command: 'test', homeDir, fileSystem }), (error) => error === failure);
    await assert.rejects(realFs.access(leasePath(homeDir)), { code: 'ENOENT' });
    await assert.rejects(realFs.access(mutationLockPath(homeDir)), { code: 'ENOENT' });
  });
});

test('heartbeat refuses a lease whose owner token changed', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'test', homeDir });
  const lease = await readLease(homeDir);
  await writeFile(leasePath(homeDir), JSON.stringify({ ...lease, ownerToken: crypto.randomUUID() }));
  await assert.rejects(handle.heartbeat(), /owner token/i);
});

test('release refuses a lease whose owner token changed', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'test', homeDir });
  const lease = await readLease(homeDir);
  await writeFile(leasePath(homeDir), JSON.stringify({ ...lease, ownerToken: crypto.randomUUID() }));
  await assert.rejects(handle.release(), /owner token/i);
  assert.equal((await inspectValidationLease({ homeDir })).status, 'active');
});

test('heartbeat updates heartbeatAt and expiry using the injected clock', async () => {
  const homeDir = await tempHome();
  let clock = Date.parse('2026-07-12T00:00:00.000Z');
  const handle = await acquireValidationLease({ command: 'test', homeDir, now: () => clock });
  clock += 10_000;
  const snapshot = await handle.heartbeat();
  assert.equal(snapshot.heartbeatAt, '2026-07-12T00:00:10.000Z');
  assert.equal((await readLease(homeDir)).heartbeatAt, snapshot.heartbeatAt);
  await handle.release();
});

test('failed heartbeat temp write is cleaned so a later heartbeat can succeed', async () => {
  const homeDir = await tempHome();
  const failure = ioError('temp write failed');
  let failNextTempWrite = true;
  const fileSystem = {
    ...realFs,
    async writeFile(target, data, options) {
      if (target.includes('.tmp') && failNextTempWrite) {
        failNextTempWrite = false;
        await realFs.writeFile(target, '', options);
        throw failure;
      }
      return realFs.writeFile(target, data, options);
    },
  };
  const handle = await acquireValidationLease({ command: 'test', homeDir, fileSystem });
  await assert.rejects(handle.heartbeat(), (error) => error === failure);
  await handle.heartbeat();
  await handle.release();
});

test('heartbeat retries transient Windows atomic replace failures', async () => {
  const homeDir = await tempHome();
  let attempts = 0;
  const fileSystem = {
    ...realFs,
    async rename(from, to) {
      if (to === leasePath(homeDir) && attempts++ < 2) throw Object.assign(new Error('busy'), { code: attempts === 1 ? 'EPERM' : 'EBUSY' });
      return realFs.rename(from, to);
    },
  };
  const handle = await acquireValidationLease({ command: 'test', homeDir, fileSystem });
  await handle.heartbeat();
  assert.equal(attempts, 3);
  await handle.release();
});

test('stale leases remain blocking and are never auto-taken over', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'old', homeDir, now: 0 });
  assert.equal((await inspectValidationLease({ homeDir, now: 100_000 })).status, 'stale');
  await assert.rejects(acquireValidationLease({ command: 'new', homeDir, now: 100_000 }), /already exists/i);
  await handle.release();
});

test('corrupt JSON fails closed for inspection and acquisition', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'test', homeDir });
  await writeFile(leasePath(homeDir), '{not-json');
  assert.equal((await inspectValidationLease({ homeDir })).status, 'corrupt');
  await assert.rejects(acquireValidationLease({ command: 'new', homeDir }), /already exists/i);
  handle.stopHeartbeat();
});

test('inspection propagates non-ENOENT filesystem read failures', async () => {
  const homeDir = await tempHome();
  const failure = ioError('read failed');
  const fileSystem = { ...realFs, readFile: async () => { throw failure; } };
  await assert.rejects(inspectValidationLease({ homeDir, fileSystem }), (error) => error === failure);
});

test('mutation lock cleanup surfaces ownership-read and unlink failures', async (t) => {
  await t.test('ownership read failure', async () => {
    const homeDir = await tempHome();
    const failure = ioError('lock owner read failed');
    let failCleanupRead = true;
    const fileSystem = {
      ...realFs,
      async readFile(target, encoding) {
        if (target === mutationLockPath(homeDir) && failCleanupRead) {
          failCleanupRead = false;
          throw failure;
        }
        return realFs.readFile(target, encoding);
      },
    };
    await assert.rejects(acquireValidationLease({ command: 'test', homeDir, fileSystem }), (error) => error === failure);
  });

  await t.test('unlink failure', async () => {
    const homeDir = await tempHome();
    const failure = ioError('lock unlink failed');
    const fileSystem = {
      ...realFs,
      async unlink(target) {
        if (target === mutationLockPath(homeDir)) throw failure;
        return realFs.unlink(target);
      },
    };
    await assert.rejects(acquireValidationLease({ command: 'test', homeDir, fileSystem }), (error) => error === failure);
  });
});

test('recovery rejects missing confirmation', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'old', homeDir, now: 0 });
  await assert.rejects(recoverValidationLease({ homeDir, expectedOwnerToken: handle.snapshot.ownerToken, reason: 'owner gone', now: 100_000 }), /confirmNoOwner/i);
});

test('recovery rejects an empty reason', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'old', homeDir, now: 0 });
  await assert.rejects(recoverValidationLease({ homeDir, expectedOwnerToken: handle.snapshot.ownerToken, confirmNoOwner: true, reason: '   ', now: 100_000 }), /reason/i);
});

test('recovery rejects the wrong owner token', async () => {
  const homeDir = await tempHome();
  await acquireValidationLease({ command: 'old', homeDir, now: 0 });
  await assert.rejects(recoverValidationLease({ homeDir, expectedOwnerToken: crypto.randomUUID(), confirmNoOwner: true, reason: 'owner gone', now: 100_000 }), /owner token/i);
});

test('recovery rejects an active lease', async () => {
  const homeDir = await tempHome();
  const handle = await acquireValidationLease({ command: 'active', homeDir, now: 0 });
  await assert.rejects(recoverValidationLease({ homeDir, expectedOwnerToken: handle.snapshot.ownerToken, confirmNoOwner: true, reason: 'mistake', now: 1 }), /not stale/i);
  await handle.release();
});

test('valid stale recovery archives the lease and permits a new acquire', async () => {
  const homeDir = await tempHome();
  const old = await acquireValidationLease({ command: 'old', homeDir, now: 0 });
  const recovered = await recoverValidationLease({ homeDir, expectedOwnerToken: old.snapshot.ownerToken, confirmNoOwner: true, reason: 'verified process ended', now: 100_000 });
  const archive = JSON.parse(await readFile(recovered.archivePath, 'utf8'));
  assert.equal(archive.ownerToken, old.snapshot.ownerToken);
  assert.equal(archive.recoveryReason, 'verified process ended');
  assert.match(path.basename(recovered.archivePath), /^validation-lease\.recovered\./);
  assert.ok((await readdir(path.dirname(leasePath(homeDir)))).includes(path.basename(recovered.archivePath)));
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
  const next = await acquireValidationLease({ command: 'new', homeDir });
  await next.release();
});

test('abandoned mutation lock is archived and permits explicit stale lease recovery', async () => {
  const homeDir = await tempHome();
  const old = await acquireValidationLease({ command: 'old', homeDir, now: 0 });
  await writeFile(mutationLockPath(homeDir), JSON.stringify({ ownerToken: crypto.randomUUID(), acquiredAt: new Date(0).toISOString() }), { flag: 'wx' });
  await utimes(mutationLockPath(homeDir), new Date(0), new Date(0));
  const recovered = await recoverValidationLease({
    homeDir,
    expectedOwnerToken: old.snapshot.ownerToken,
    confirmNoOwner: true,
    reason: 'verified owner ended',
    now: 100_000,
  });
  assert.equal(recovered.snapshot.status, 'recovered');
  const names = await readdir(path.dirname(leasePath(homeDir)));
  assert.ok(names.some((name) => name.startsWith('validation-lease.mutation.abandoned.')));
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
});

test('wrapper releases the lease when its callback throws', async () => {
  const homeDir = await tempHome();
  await assert.rejects(withValidationLease({ command: 'wrapped', homeDir }, async () => {
    throw new Error('ordinary test failure');
  }), /ordinary test failure/);
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
});

test('wrapper heartbeat advances while the main thread is synchronously blocked', async () => {
  const homeDir = await tempHome();
  let initialHeartbeat;
  await withValidationLease({ command: 'blocked-main', homeDir, heartbeatIntervalMs: 20 }, async (handle) => {
    initialHeartbeat = handle.snapshot.heartbeatAt;
    const child = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 180)']);
    assert.equal(child.status, 0);
    const inspection = await inspectValidationLease({ homeDir });
    assert.equal(inspection.status, 'active');
    assert.ok(Date.parse(inspection.snapshot.heartbeatAt) > Date.parse(initialHeartbeat));
  });
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
});

test('wrapper disables worker heartbeats when heartbeatIntervalMs is nonpositive', async () => {
  const homeDir = await tempHome();
  await withValidationLease({ command: 'no-heartbeat', homeDir, heartbeatIntervalMs: 0 }, async (handle) => {
    const initialHeartbeat = handle.snapshot.heartbeatAt;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await readLease(homeDir)).heartbeatAt, initialHeartbeat);
  });
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
});

test('unexpected worker heartbeat failure exits promptly and still releases', async () => {
  const homeDir = await tempHome();
  const startedAt = Date.now();
  await assert.rejects(withValidationLease({ command: 'worker-error', homeDir, heartbeatIntervalMs: 10 }, async () => {
    await unlink(leasePath(homeDir));
    await new Promise((resolve) => setTimeout(resolve, 60));
  }), /heartbeat|absent|worker/i);
  assert.ok(Date.now() - startedAt < 2_000);
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
});

test('worker failure aggregates with callback failure and still releases', async () => {
  const homeDir = await tempHome();
  await assert.rejects(withValidationLease({ command: 'combined-error', homeDir, heartbeatIntervalMs: 10 }, async () => {
    await unlink(leasePath(homeDir));
    await new Promise((resolve) => setTimeout(resolve, 60));
    throw new Error('callback failed too');
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.some((item) => /callback failed too/.test(item.message)));
    assert.ok(error.errors.some((item) => /heartbeat|absent|worker/i.test(item.message)));
    return true;
  });
  assert.equal((await inspectValidationLease({ homeDir })).status, 'absent');
});
