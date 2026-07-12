import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';

const LEASE_TTL_MS = 90_000;
const MUTATION_ABANDONED_MS = 30_000;
const MUTATION_TIMEOUT_MS = 100;
const DEFAULT_FILE_SYSTEM = { mkdir, open, readFile, rename, stat, unlink, writeFile };

class CorruptLeaseError extends Error {}

function throwWithCleanupError(originalError, cleanupErrors) {
  if (cleanupErrors.length === 0) throw originalError;
  throw new AggregateError(
    [originalError, ...cleanupErrors],
    `${originalError.message}; artifact cleanup also failed`,
    { cause: originalError },
  );
}

function pathsFor(homeDir = os.homedir()) {
  const directory = path.join(homeDir, '.happyhome');
  return {
    directory,
    leasePath: path.join(directory, 'validation-lease.json'),
    mutationLockPath: path.join(directory, 'validation-lease.mutation.lock'),
  };
}

async function withMutationLock(directory, fn, now, fileSystem = DEFAULT_FILE_SYSTEM) {
  const mutationLockPath = path.join(directory, 'validation-lease.mutation.lock');
  const ownerToken = randomUUID();
  const deadline = Date.now() + MUTATION_TIMEOUT_MS;
  let lock;
  while (!lock) {
    try {
      lock = await fileSystem.open(mutationLockPath, 'wx');
      try {
        await lock.writeFile(JSON.stringify({ ownerToken, acquiredAt: timestamp(now).toISOString() }));
      } catch (writeError) {
        await lock.close().catch(() => {});
        await fileSystem.unlink(mutationLockPath).catch(() => {});
        throw writeError;
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let details;
      let source;
      try {
        [details, source] = await Promise.all([
          fileSystem.stat(mutationLockPath),
          fileSystem.readFile(mutationLockPath, 'utf8'),
        ]);
      } catch (inspectionError) {
        if (inspectionError?.code === 'ENOENT') continue;
        throw inspectionError;
      }
      let recordedAt = Number.NaN;
      try { recordedAt = Date.parse(JSON.parse(source).acquiredAt); } catch {}
      const freshestEvidence = Math.max(details.mtimeMs, Number.isFinite(recordedAt) ? recordedAt : 0);
      if (timestamp(now).getTime() - freshestEvidence > MUTATION_ABANDONED_MS) {
        const archivePath = path.join(directory, `validation-lease.mutation.abandoned.${randomUUID()}.lock`);
        try {
          await fileSystem.rename(mutationLockPath, archivePath);
          continue;
        } catch (archiveError) {
          if (archiveError?.code === 'ENOENT') continue;
          throw archiveError;
        }
      }
      if (Date.now() >= deadline) throw new Error('validation lease mutation busy');
      await delay(5);
    }
  }
  try {
    return await fn();
  } finally {
    let closeError;
    try {
      await lock.close();
    } catch (error) {
      closeError = error;
    }
    const cleanupErrors = [];
    let currentSource;
    try {
      currentSource = await fileSystem.readFile(mutationLockPath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') cleanupErrors.push(error);
    }
    let currentOwner;
    try { currentOwner = JSON.parse(currentSource).ownerToken; } catch {}
    if (currentOwner === ownerToken) {
      try {
        await fileSystem.unlink(mutationLockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') cleanupErrors.push(error);
      }
    }
    if (closeError) throwWithCleanupError(closeError, cleanupErrors);
    if (cleanupErrors.length) throw cleanupErrors[0];
  }
}

function timestamp(now) {
  const value = typeof now === 'function' ? now() : (now ?? Date.now());
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('now must be a valid time');
  return date;
}

async function readSnapshot(leasePath, fileSystem = DEFAULT_FILE_SYSTEM) {
  const source = await fileSystem.readFile(leasePath, 'utf8');
  let snapshot;
  try {
    snapshot = JSON.parse(source);
  } catch {
    throw new CorruptLeaseError('Validation lease is corrupt');
  }
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.ownerToken !== 'string') {
    throw new CorruptLeaseError('Validation lease is corrupt');
  }
  return snapshot;
}

function assertOwner(snapshot, ownerToken) {
  if (snapshot.ownerToken !== ownerToken) {
    throw new Error('Validation lease owner token does not match');
  }
}

async function replaceOwnedLease(leasePath, ownerToken, update, fileSystem) {
  let snapshot;
  try {
    snapshot = await readSnapshot(leasePath, fileSystem);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Validation lease is absent');
    if (error instanceof CorruptLeaseError) throw error;
    throw error;
  }
  assertOwner(snapshot, ownerToken);
  const next = update(snapshot);
  const temporaryPath = `${leasePath}.${ownerToken}.tmp`;
  try {
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    const current = await readSnapshot(leasePath, fileSystem);
    assertOwner(current, ownerToken);
    await fileSystem.rename(temporaryPath, leasePath);
  } catch (error) {
    await fileSystem.unlink(temporaryPath).catch((cleanupError) => {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
  return next;
}

export async function inspectValidationLease({ homeDir, now, fileSystem = DEFAULT_FILE_SYSTEM } = {}) {
  const { leasePath } = pathsFor(homeDir);
  let snapshot;
  try {
    snapshot = await readSnapshot(leasePath, fileSystem);
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'absent' };
    if (error instanceof CorruptLeaseError) return { status: 'corrupt', error: error.message };
    throw error;
  }
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(expiresAt)) return { status: 'corrupt', snapshot };
  return {
    status: timestamp(now).getTime() > expiresAt ? 'stale' : 'active',
    snapshot,
  };
}

export async function acquireValidationLease({
  command,
  homeDir,
  now,
  heartbeatIntervalMs = 0,
  fileSystem = DEFAULT_FILE_SYSTEM,
  startHeartbeat = true,
} = {}) {
  if (typeof command !== 'string' || !command.trim()) throw new TypeError('command is required');
  const { directory, leasePath } = pathsFor(homeDir);
  await fileSystem.mkdir(directory, { recursive: true });
  const ownerToken = randomUUID();
  const acquired = timestamp(now);
  const ttlMs = heartbeatIntervalMs > 0 ? heartbeatIntervalMs * 3 : LEASE_TTL_MS;
  let snapshot = {
    schemaVersion: 1,
    ownerToken,
    command: command.trim(),
    cwd: process.cwd(),
    pid: process.pid,
    acquiredAt: acquired.toISOString(),
    heartbeatAt: acquired.toISOString(),
    expiresAt: new Date(acquired.getTime() + ttlMs).toISOString(),
    status: 'active',
  };
  await withMutationLock(directory, async () => {
  let file;
  let wroteLease = false;
  try {
    file = await fileSystem.open(leasePath, 'wx');
    await file.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`);
    wroteLease = true;
  } catch (error) {
      if (error?.code === 'EEXIST') throw new Error(`Validation lease already exists at ${leasePath}`);
      if (file) {
        await file.close().catch(() => {});
        file = undefined;
        await fileSystem.unlink(leasePath).catch(() => {});
      }
      throw error;
  } finally {
      if (file) {
        try {
          await file.close();
        } catch (closeError) {
          const cleanupErrors = [];
          if (wroteLease) {
            try {
              const current = await readSnapshot(leasePath, fileSystem);
              assertOwner(current, ownerToken);
              await fileSystem.unlink(leasePath);
            } catch (cleanupError) {
              if (cleanupError?.code !== 'ENOENT') cleanupErrors.push(cleanupError);
            }
          }
          throwWithCleanupError(closeError, cleanupErrors);
        }
      }
    }
  }, now, fileSystem);

  let interval;
  const handle = {
    get snapshot() { return snapshot; },
    async heartbeat() {
      snapshot = await withMutationLock(directory, async () => {
        const heartbeatAt = timestamp(now);
        return replaceOwnedLease(leasePath, ownerToken, (current) => ({
          ...current,
          heartbeatAt: heartbeatAt.toISOString(),
          expiresAt: new Date(heartbeatAt.getTime() + ttlMs).toISOString(),
        }), fileSystem);
      }, now, fileSystem);
      return snapshot;
    },
    stopHeartbeat() {
      if (interval) clearInterval(interval);
      interval = undefined;
    },
    async release() {
      handle.stopHeartbeat();
      return withMutationLock(directory, async () => {
        let current;
        try {
          current = await readSnapshot(leasePath, fileSystem);
        } catch (error) {
          if (error?.code === 'ENOENT') return false;
          if (error instanceof CorruptLeaseError) throw error;
          throw error;
        }
        assertOwner(current, ownerToken);
        await fileSystem.unlink(leasePath);
        return true;
      }, now, fileSystem);
    },
  };

  if (startHeartbeat && heartbeatIntervalMs > 0) {
    interval = setInterval(() => { handle.heartbeat().catch(() => handle.stopHeartbeat()); }, heartbeatIntervalMs);
    interval.unref?.();
  }
  return handle;
}

export async function heartbeatValidationLeaseOwner({ homeDir, ownerToken, ttlMs }) {
  const { directory, leasePath } = pathsFor(homeDir);
  return withMutationLock(directory, async () => {
    const heartbeatAt = new Date();
    return replaceOwnedLease(leasePath, ownerToken, (current) => ({
      ...current,
      heartbeatAt: heartbeatAt.toISOString(),
      expiresAt: new Date(heartbeatAt.getTime() + ttlMs).toISOString(),
    }), DEFAULT_FILE_SYSTEM);
  });
}

async function startHeartbeatWorker({ homeDir, ownerToken, heartbeatIntervalMs }) {
  const worker = new Worker(new URL('./validation-lease-heartbeat-worker.mjs', import.meta.url), {
    workerData: {
      homeDir,
      ownerToken,
      heartbeatIntervalMs,
      ttlMs: heartbeatIntervalMs * 3,
    },
  });
  let workerError;
  let exited = false;
  let stopping = false;
  worker.on('error', (error) => { workerError ??= error; });
  worker.on('exit', (code) => {
    exited = true;
    if (!stopping) workerError ??= new Error(`Validation lease heartbeat worker exited unexpectedly with code ${code}`);
  });
  worker.on('message', (message) => {
    if (message?.type === 'error') workerError ??= new Error(message.message);
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Validation lease heartbeat worker startup timed out')), 5_000);
    const onMessage = (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      } else if (message?.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(message.message));
      }
    };
    worker.on('message', onMessage);
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      reject(workerError ?? new Error(`Validation lease heartbeat worker exited before ready with code ${code}`));
    });
  });
  try {
    await ready;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  return {
    async stop() {
      let stopError;
      stopping = true;
      if (!workerError && !exited) {
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Validation lease heartbeat worker stop timed out')),
              1_000,
            );
            const onMessage = (message) => {
              if (message?.type === 'stopped') {
                clearTimeout(timeout);
                resolve();
              }
              if (message?.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(message.message));
              }
            };
            worker.on('message', onMessage);
            worker.once('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            worker.once('exit', (code) => {
              clearTimeout(timeout);
              reject(workerError ?? new Error(`Validation lease heartbeat worker exited during stop with code ${code}`));
            });
            worker.postMessage({ type: 'stop' });
          });
        } catch (error) {
          stopError = error;
        }
      }
      await worker.terminate();
      if (workerError) throw workerError;
      if (stopError) throw stopError;
    },
  };
}

export async function recoverValidationLease({
  homeDir,
  expectedOwnerToken,
  confirmNoOwner,
  reason,
  now,
  fileSystem = DEFAULT_FILE_SYSTEM,
} = {}) {
  if (confirmNoOwner !== true) throw new Error('confirmNoOwner must be true');
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('Recovery reason is required');
  const { directory, leasePath } = pathsFor(homeDir);
  return withMutationLock(directory, async () => {
    const inspection = await inspectValidationLease({ homeDir, now, fileSystem });
    if (inspection.status === 'corrupt') throw new Error('Validation lease is corrupt');
    if (inspection.status !== 'stale') throw new Error('Validation lease is not stale');
    assertOwner(inspection.snapshot, expectedOwnerToken);
    const recoveredAt = timestamp(now).toISOString();
    const archivePath = path.join(
      directory,
      `validation-lease.recovered.${recoveredAt.replaceAll(':', '-')}.${randomUUID()}.json`,
    );
    const archive = {
      ...inspection.snapshot,
      status: 'recovered',
      recoveredAt,
      recoveryReason: reason.trim(),
    };
    await fileSystem.writeFile(archivePath, `${JSON.stringify(archive, null, 2)}\n`, { flag: 'wx' });
    const current = await readSnapshot(leasePath, fileSystem);
    assertOwner(current, expectedOwnerToken);
    await fileSystem.unlink(leasePath);
    return { archivePath, snapshot: archive };
  }, now, fileSystem);
}

export async function withValidationLease(options, fn) {
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 30_000;
  const homeDir = options?.homeDir ?? os.homedir();
  const handle = await acquireValidationLease({
    ...options,
    homeDir,
    heartbeatIntervalMs,
    startHeartbeat: false,
  });
  let worker;
  let result;
  let primaryError;
  try {
    if (heartbeatIntervalMs > 0) {
      worker = await startHeartbeatWorker({
        homeDir,
        ownerToken: handle.snapshot.ownerToken,
        heartbeatIntervalMs,
      });
    }
    result = await fn(handle);
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  handle.stopHeartbeat();
  try {
    await worker?.stop();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await handle.release();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primaryError) throwWithCleanupError(primaryError, cleanupErrors);
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Validation lease cleanup failed');
  return result;
}
