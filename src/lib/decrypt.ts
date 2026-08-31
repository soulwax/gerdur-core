import crypto from 'crypto';
import {Transform} from 'stream';
import type {trackType} from '../types';
import {Blowfish} from './blowfish';

const md5 = (data: string, type: crypto.Encoding = 'ascii') => {
  const md5sum = crypto.createHash('md5');
  md5sum.update(data.toString(), type);
  return md5sum.digest('hex');
};

export const getSongFileName = ({MD5_ORIGIN, SNG_ID, MEDIA_VERSION}: trackType, quality: number) => {
  if (!MD5_ORIGIN) {
    throw new Error(`Missing MD5_ORIGIN for track ${SNG_ID}`);
  }

  const step1 = [MD5_ORIGIN, quality, SNG_ID, MEDIA_VERSION].join('¤');

  let step2 = md5(step1) + '¤' + step1 + '¤';
  while (step2.length % 16 > 0) step2 += ' ';

  return crypto.createCipheriv('aes-128-ecb', 'jo6aey6haid2Teih', '').update(step2, 'ascii', 'hex');
};

const BLOWFISH_SECRET = 'g4el58wc0zvf9na1';

/** Per-track Blowfish key: md5(id)[i] ^ md5(id)[i+16] ^ SECRET[i], for i in 0..15. */
const getBlowfishKey = (trackId: string): Buffer => {
  const idMd5 = md5(trackId);
  const key = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) {
    key[i] = idMd5.charCodeAt(i) ^ idMd5.charCodeAt(i + 16) ^ BLOWFISH_SECRET.charCodeAt(i);
  }
  return key;
};

const CHUNK = 2048;

// Note: memoising the initialised Blowfish schedule per track was measured and
// rejected — key setup is 39.7µs against 33ms to decrypt an 8 MiB file (0.12%),
// break-even at ~10 KiB decrypted per key. Not worth the cache.

/**
 * Decrypt a downloaded track. Deezer applies Blowfish-CBC "stripe" obfuscation:
 * the file is split into 2048-byte chunks and only every third chunk (0, 3, 6…)
 * is encrypted; the rest — and any trailing partial chunk — are plaintext.
 *
 * @param source Downloaded body from `getTrackDownloadUrl`
 * @param trackId `SNG_ID` as a string
 */
export const decryptDownload = (source: Buffer, trackId: string): Buffer => {
  const bf = new Blowfish(getBlowfishKey(trackId));
  const dest = Buffer.allocUnsafe(source.length);
  let position = 0;
  let chunkIndex = 0;

  while (position < source.length) {
    const size = Math.min(CHUNK, source.length - position);
    if (chunkIndex % 3 === 0 && size === CHUNK) {
      bf.decryptCbc(source, position, CHUNK, dest);
    } else {
      source.copy(dest, position, position, position + size);
    }
    position += size;
    chunkIndex++;
  }

  return dest;
};

/**
 * Streaming variant: feed it socket chunks in order via `write()`, then call
 * `final()`. Decrypts each 2048-byte stripe as it completes — constant memory,
 * and the CPU work hides behind the (slower) network read.
 */
export class TrackDecryptStream {
  private readonly bf: Blowfish;
  private carry = Buffer.alloc(0);
  private chunkIndex: number;

  /**
   * @param trackId    `SNG_ID`
   * @param startChunk the 2048-byte chunk index the first byte you'll `write()`
   *                   corresponds to — non-zero when resuming a `Range` download
   *                   (`resumeFromByte / 2048`). Per-chunk IVs make this exact.
   */
  constructor(trackId: string, startChunk = 0) {
    this.bf = new Blowfish(getBlowfishKey(trackId));
    this.chunkIndex = startChunk;
  }

  /** Returns the decrypted bytes for every complete 2048-byte stripe now available. */
  write(part: Buffer): Buffer {
    const data = this.carry.length ? Buffer.concat([this.carry, part]) : part;
    const complete = data.length - (data.length % CHUNK);
    if (complete === 0) {
      this.carry = data;
      return Buffer.alloc(0);
    }
    const out = Buffer.allocUnsafe(complete);
    for (let off = 0; off < complete; off += CHUNK) {
      if (this.chunkIndex % 3 === 0) {
        this.bf.decryptCbc(data, off, CHUNK, out);
      } else {
        data.copy(out, off, off, off + CHUNK);
      }
      this.chunkIndex++;
    }
    this.carry = data.subarray(complete);
    return out;
  }

  /** The trailing partial chunk (always plaintext). */
  final(): Buffer {
    const rest = this.carry;
    this.carry = Buffer.alloc(0);
    return rest;
  }
}

/**
 * A Node `Transform` that decrypts a Deezer download stripe-by-stripe as bytes
 * flow through it — `fetch(url) → createDecryptStream(sngId) → sink`, constant
 * memory. `startChunk` (`resumeFromByte / 2048`) supports resumed `Range` fetches.
 */
export const createDecryptStream = (trackId: string, startChunk = 0): Transform => {
  const engine = new TrackDecryptStream(trackId, startChunk);
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        cb(null, engine.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb) {
      cb(null, engine.final());
    },
  });
};
