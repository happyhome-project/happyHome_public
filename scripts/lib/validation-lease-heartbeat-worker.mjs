import { parentPort, workerData } from 'node:worker_threads';

import { heartbeatValidationLeaseOwner } from './validation-lease.mjs';

let timer;
let running = Promise.resolve();

async function heartbeat() {
  await heartbeatValidationLeaseOwner(workerData);
}

try {
  await heartbeat();
  parentPort.postMessage({ type: 'ready' });
  timer = setInterval(() => {
    running = running.then(heartbeat).catch((error) => {
      clearInterval(timer);
      parentPort.postMessage({ type: 'error', message: error.message });
      parentPort.close();
    });
  }, workerData.heartbeatIntervalMs);
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error.message });
  parentPort.close();
}

parentPort.on('message', async (message) => {
  if (message?.type !== 'stop') return;
  clearInterval(timer);
  await running;
  parentPort.postMessage({ type: 'stopped' });
});
