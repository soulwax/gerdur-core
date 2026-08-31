import test from 'ava';
import {decryptDownload} from '../src/lib/decrypt';
import {
  createPooledDecryptStream,
  configureDecryptPool,
  decryptPoolStats,
  shutdownDecryptPool,
} from '../src/lib/decrypt-pool';

/**
 * The pool exists to move Blowfish off the event loop. It must produce exactly
 * what the in-thread path produces — including ordering, since batches come back
 * from the workers out of order.
 */

const BATCH = 2046 * 2048; // one dispatch unit

const body = (bytes: number) => {
  const b = Buffer.allocUnsafe(bytes);
  for (let i = 0; i < bytes; i++) b[i] = (i * 31 + 7) & 0xff; // deterministic, not uniform
  return b;
};

const run = async (input: Buffer, trackId: string, writeChunk: number, startChunk = 0): Promise<Buffer> => {
  const s = createPooledDecryptStream(trackId, startChunk);
  const out: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    s.on('data', (d: Buffer) => out.push(d));
    s.on('end', () => resolve());
    s.on('error', reject);
  });
  for (let i = 0; i < input.length; i += writeChunk) s.write(input.subarray(i, i + writeChunk));
  s.end();
  await done;
  return Buffer.concat(out);
};

test.after.always(async () => {
  await shutdownDecryptPool();
});

test.serial('single batch and below — identical to decryptDownload', async (t) => {
  for (const size of [2048, 6144, 100_000, BATCH]) {
    const src = body(size);
    const expected = decryptDownload(src, '3135556');
    t.true((await run(src, '3135556', 64 * 1024)).equals(expected), `size ${size}`);
  }
});

test.serial('many batches — ordering is preserved across workers', async (t) => {
  const src = body(BATCH * 3 + 5000); // 3 full batches + a partial tail
  const expected = decryptDownload(src, '3135556');
  for (const writeChunk of [64 * 1024, 1024 * 1024, src.length]) {
    const actual = await run(src, '3135556', writeChunk);
    t.is(actual.length, expected.length, `len @ ${writeChunk}`);
    t.true(actual.equals(expected), `bytes @ ${writeChunk}`);
  }
});

test.serial('a trailing partial stripe stays plaintext', async (t) => {
  const src = body(BATCH + 1000); // tail shorter than a stripe
  const expected = decryptDownload(src, '999');
  const actual = await run(src, '999', 4096);
  t.true(actual.equals(expected));
  t.true(actual.subarray(actual.length - 1000).equals(src.subarray(src.length - 1000)), 'tail untouched');
});

test.serial('startChunk resumes stripe phase', async (t) => {
  const whole = body(BATCH + 12288);
  const full = decryptDownload(whole, '3135556');
  // decrypt only the second half, telling the stream which chunk it starts at
  const offset = 6144 * 4;
  const actual = await run(whole.subarray(offset), '3135556', 8192, offset / 2048);
  t.true(actual.equals(full.subarray(offset)), 'resumed slice matches the whole-file decrypt');
});

test.serial('pool spins up and reports state', async (t) => {
  // resizing only takes effect as workers recycle, so start from empty
  await shutdownDecryptPool();
  configureDecryptPool({size: 2, idleMs: 50});
  await run(body(BATCH * 2), '3135556', 256 * 1024);
  const stats = decryptPoolStats();
  t.is(stats.size, 2);
  t.true(stats.workers >= 1 && stats.workers <= 2, `workers ${stats.workers}`);
  t.is(stats.busy, 0, 'all idle once the stream ends');
});
