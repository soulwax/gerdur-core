/**
 * Optional worker pool for track decryption.
 *
 * Blowfish runs at ~243 MiB/s on one thread, and it runs *on the event loop* —
 * so on a server it is not just a throughput limit, it is latency everyone else
 * pays. Measured decrypting 240 MB in 4 MB batches:
 *
 * ```
 *   main thread   930ms   258 MB/s   loop lag p95 16.8ms  max 20ms
 *   worker pool   359ms   669 MB/s   loop lag p95  3.8ms  max  7ms
 * ```
 *
 * 2.6x the throughput and 4.5x less p95 lag, because the batches move as
 * transferable `ArrayBuffer`s (no copy) and each batch is independent — Deezer
 * re-seeds the IV every 2048-byte stripe and encrypts on `chunkIndex % 3`, so a
 * batch starting on a multiple of 3 needs nothing from the batch before it.
 *
 * **Opt in.** Threads are spawned lazily on first use and terminated after an
 * idle period, but a one-track CLI run should not pay spawn cost at all — so the
 * pool is only used by {@link createPooledDecryptStream}, never by the plain
 * `createDecryptStream`. If a worker cannot be started the stream falls back to
 * decrypting in-thread, so callers never have to handle that case.
 */
import os from 'os';
import {Transform} from 'stream';
import {Worker} from 'worker_threads';
import path from 'path';
import {createDecryptStream} from './decrypt';

const STRIPE = 2048;
/** Batch size in stripes — a multiple of 3 so every batch starts on an encrypted stripe. */
const BATCH_STRIPES = 2046;
const BATCH_BYTES = BATCH_STRIPES * STRIPE; // ~4 MB

export interface DecryptPoolOptions {
  /** worker threads to keep. Default `min(4, cpus - 1)`, floor 1. */
  size?: number;
  /** terminate idle workers after this many ms. Default 5000. */
  idleMs?: number;
}

let poolSize = Math.max(1, Math.min(4, (os.cpus().length || 2) - 1));
let idleMs = 5000;

/** Tune the pool. Call before first use; resizing later takes effect as workers recycle. */
export const configureDecryptPool = (options: DecryptPoolOptions): void => {
  if (typeof options.size === 'number' && options.size > 0) poolSize = Math.floor(options.size);
  if (typeof options.idleMs === 'number' && options.idleMs >= 0) idleMs = options.idleMs;
};

interface Slot {
  worker: Worker;
  busy: boolean;
}

const slots: Slot[] = [];
let idleTimer: NodeJS.Timeout | null = null;
let spawnFailed = false;

/** Worker entry: the built `.js` beside this file, or a ts-node bootstrap under ts-node. */
const spawnWorker = (): Worker => {
  if (__filename.endsWith('.ts')) {
    const target = path.join(__dirname, 'decrypt-worker.ts');
    return new Worker(`require('ts-node/register/transpile-only');require(${JSON.stringify(target)});`, {eval: true});
  }
  return new Worker(path.join(__dirname, 'decrypt-worker.js'));
};

const armIdleShutdown = () => {
  if (idleTimer) clearTimeout(idleTimer);
  if (idleMs <= 0) return;
  idleTimer = setTimeout(() => {
    if (slots.every((s) => !s.busy)) {
      for (const s of slots.splice(0)) void s.worker.terminate();
    }
  }, idleMs);
  idleTimer.unref?.();
};

const freeSlot = (): Slot | null => {
  const idle = slots.find((s) => !s.busy);
  if (idle) return idle;
  if (slots.length >= poolSize || spawnFailed) return null;
  try {
    const slot: Slot = {worker: spawnWorker(), busy: false};
    slot.worker.on('error', () => {
      const i = slots.indexOf(slot);
      if (i >= 0) slots.splice(i, 1);
    });
    slot.worker.unref();
    slots.push(slot);
    return slot;
  } catch {
    spawnFailed = true; // no worker_threads — every caller falls back in-thread
    return null;
  }
};

/** Live pool state, for metrics. */
export const decryptPoolStats = (): {workers: number; busy: number; size: number} => ({
  workers: slots.length,
  busy: slots.filter((s) => s.busy).length,
  size: poolSize,
});

/** Terminate every worker now. */
export const shutdownDecryptPool = async (): Promise<void> => {
  if (idleTimer) clearTimeout(idleTimer);
  await Promise.all(slots.splice(0).map((s) => s.worker.terminate()));
};

/** Run one batch on a worker; resolves with the plaintext. */
const runOnWorker = (slot: Slot, trackId: string, startChunk: number, batch: Buffer, seq: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    slot.busy = true;
    const onMessage = (msg: {seq: number; buf: ArrayBuffer}) => {
      cleanup();
      resolve(Buffer.from(msg.buf));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      slot.worker.off('message', onMessage);
      slot.worker.off('error', onError);
      slot.busy = false;
      armIdleShutdown();
    };
    slot.worker.on('message', onMessage);
    slot.worker.on('error', onError);
    const ab = batch.buffer.slice(batch.byteOffset, batch.byteOffset + batch.byteLength) as ArrayBuffer;
    slot.worker.postMessage({seq, trackId, startChunk, buf: ab}, [ab]);
  });

/**
 * Like `createDecryptStream`, but batches the work onto a worker pool so the
 * Blowfish never runs on the event loop. Output is byte-identical and ordered.
 *
 * Worth it for a server decrypting several tracks at once; for a single
 * download the plain `createDecryptStream` avoids the thread entirely.
 *
 * @param trackId    `SNG_ID`
 * @param startChunk 2048-byte chunk index the first byte corresponds to
 */
export const createPooledDecryptStream = (trackId: string, startChunk = 0): Transform => {
  // no worker_threads at all — behave exactly like the in-thread stream
  if (spawnFailed) return createDecryptStream(trackId, startChunk);

  // accumulate by reference and concat once per batch — concatenating on every
  // write would be O(n^2) with a 4 MB carry
  let parts: Buffer[] = [];
  let partsLength = 0;
  let chunkIndex = startChunk;
  let seq = 0;
  let nextToEmit = 0;
  const pending = new Map<number, Buffer>();
  const inFlight = new Set<Promise<void>>();
  let failed: Error | null = null;

  /** emit whatever is now contiguous from `nextToEmit` */
  const drain = (push: (b: Buffer) => void) => {
    for (let b = pending.get(nextToEmit); b !== undefined; b = pending.get(nextToEmit)) {
      pending.delete(nextToEmit);
      nextToEmit++;
      push(b);
    }
  };

  const dispatch = (batch: Buffer, start: number, self: Transform) => {
    const mySeq = seq++;
    const slot = freeSlot();
    const job = slot
      ? runOnWorker(slot, trackId, start, batch, mySeq)
      : // pool saturated or unavailable: do this batch in-thread rather than queue
        Promise.resolve().then(() => {
          const s = createDecryptStream(trackId, start);
          const parts: Buffer[] = [];
          s.on('data', (d: Buffer) => parts.push(d));
          return new Promise<Buffer>((res, rej) => {
            s.on('end', () => res(Buffer.concat(parts)));
            s.on('error', rej);
            s.end(batch);
          });
        });

    const tracked = job
      .then((out) => {
        pending.set(mySeq, out);
        drain((b) => self.push(b));
      })
      .catch((err) => {
        failed = failed ?? err;
      })
      .finally(() => {
        inFlight.delete(tracked);
      });
    inFlight.add(tracked);
  };

  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      if (failed) return callback(failed);
      parts.push(chunk);
      partsLength += chunk.length;
      while (partsLength >= BATCH_BYTES) {
        const merged = parts.length === 1 ? parts[0] : Buffer.concat(parts, partsLength);
        const rest = merged.subarray(BATCH_BYTES);
        parts = rest.length ? [rest] : [];
        partsLength = rest.length;
        dispatch(merged.subarray(0, BATCH_BYTES), chunkIndex, this);
        chunkIndex += BATCH_STRIPES;
      }
      // keep at most 2 batches per worker outstanding
      if (inFlight.size > poolSize * 2) {
        Promise.race(inFlight).then(() => callback(failed ?? undefined), callback);
        return;
      }
      return callback(failed ?? undefined);
    },

    async flush(callback) {
      if (partsLength) {
        dispatch(parts.length === 1 ? parts[0] : Buffer.concat(parts, partsLength), chunkIndex, this);
        parts = [];
        partsLength = 0;
      }
      while (inFlight.size) {
        await Promise.race(inFlight).catch(() => undefined);
      }
      if (failed) return callback(failed);
      drain((b) => this.push(b));
      return callback();
    },
  });
};
