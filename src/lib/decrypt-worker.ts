/**
 * Worker half of the decrypt pool. Receives a stripe-aligned batch plus the
 * chunk index it starts at, and returns the plaintext with the buffer
 * transferred back (no copy).
 *
 * Batches are independent because Deezer's scheme re-seeds the IV on every
 * 2048-byte stripe and encrypts on `chunkIndex % 3`, so a batch that starts on
 * a multiple of 3 needs no state from the batch before it.
 */
import {parentPort} from 'worker_threads';
import {TrackDecryptStream} from './decrypt';

export interface DecryptJob {
  seq: number;
  trackId: string;
  startChunk: number;
  buf: ArrayBuffer;
}

parentPort?.on('message', (job: DecryptJob) => {
  const engine = new TrackDecryptStream(job.trackId, job.startChunk);
  const body = engine.write(Buffer.from(job.buf));
  const tail = engine.final();
  const out = tail.length ? Buffer.concat([body, tail]) : body;
  // copy into a standalone ArrayBuffer so the whole thing can be transferred
  const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  parentPort?.postMessage({seq: job.seq, buf: ab}, [ab]);
});
