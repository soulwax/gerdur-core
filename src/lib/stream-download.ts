import {PassThrough, Readable} from 'stream';
import {createDecryptStream} from './decrypt';
import {createPooledDecryptStream} from './decrypt-pool';
import {getStream} from './http';
import {getTrackDownloadUrl} from './get-url';
import type {Session} from './session';
import type {trackType} from '../types';

const CHUNK = 2048;

export interface StreamTrackOptions {
  /**
   * Resume from this many bytes already on disk. Rounded **down** to a 2048-byte
   * boundary so stripe decryption stays aligned; the returned `startedAt` tells
   * you where the stream actually begins.
   */
  resumeFrom?: number;
  /** progress callback — `(bytesReceived, totalBytes)`; `total` is 0 when unknown */
  onProgress?: (received: number, total: number) => void;
  /** which account to download as — defaults to the process default session */
  session?: Session;
  /**
   * Decrypt on a worker pool instead of the event loop. Off by default — a
   * single download is better off without the thread. Worth it for a server
   * running several at once: measured 2.6x the decrypt throughput and 4.5x less
   * p95 event-loop lag. Tune with `configureDecryptPool`.
   */
  pool?: boolean;
}

export interface TrackStream {
  /** decrypted audio bytes, ready to pipe to a file or a tag muxer */
  stream: Readable;
  /** total size of the (decrypted) file in bytes, or 0 if Deezer didn't say */
  size: number;
  /** byte offset the stream starts at (0, or the aligned `resumeFrom`) */
  startedAt: number;
  /** `false` for `cipher: NONE` content — the stream is the raw file */
  isEncrypted: boolean;
}

/**
 * Download a track as a **stream** of decrypted audio — `get_url` → CDN fetch →
 * stripe-decrypt transform → your sink. Peak memory is ~one 2048-byte stripe
 * regardless of file size or how many run concurrently.
 *
 * Buffer-and-tag still works: `pipeline(ts.stream, fs.createWriteStream(tmp))`,
 * then read the temp file back for `addTrackTags`. Streaming the tag write
 * itself (especially FLAC) is not done yet.
 *
 * @throws the same `WrongLicense` / `GeoBlocked` / `ExpiredTrackToken` /
 *   `DeezerError` as `getTrackDownloadUrl`, plus `Error('unavailable')` when the
 *   track+quality can't be resolved at all.
 */
export const streamTrackDownload = async (
  track: trackType,
  quality: number,
  options: StreamTrackOptions = {},
): Promise<TrackStream> => {
  const resolved = await getTrackDownloadUrl(track, quality, options.session);
  if (!resolved) {
    throw new Error(`Track ${track.SNG_ID} is unavailable at quality ${quality}`);
  }

  const startedAt = options.resumeFrom ? Math.floor(options.resumeFrom / CHUNK) * CHUNK : 0;
  const {stream: raw, headers} = await getStream(resolved.trackUrl, {rangeStart: startedAt});

  const contentLength = Number(headers['content-length']) || 0;
  const size = resolved.fileSize || (contentLength ? contentLength + startedAt : 0);

  const decryptStream = () =>
    options.pool
      ? createPooledDecryptStream(track.SNG_ID, startedAt / CHUNK)
      : createDecryptStream(track.SNG_ID, startedAt / CHUNK);

  let received = startedAt;
  if (options.onProgress) {
    const meter = new PassThrough();
    raw.on('data', (c: Buffer) => {
      received += c.length;
      options.onProgress?.(received, size);
    });
    raw.pipe(meter);
    return {
      stream: resolved.isEncrypted ? meter.pipe(decryptStream()) : meter,
      size,
      startedAt,
      isEncrypted: resolved.isEncrypted,
    };
  }

  return {
    stream: resolved.isEncrypted ? raw.pipe(decryptStream()) : raw,
    size,
    startedAt,
    isEncrypted: resolved.isEncrypted,
  };
};

/**
 * Download + decrypt a track fully into memory. Convenience over
 * {@link streamTrackDownload} for callers that just want the bytes (no tagging —
 * pipe through `addTrackTags` yourself). `null` when the track+quality can't be
 * resolved. Does **not** support resume.
 */
export const downloadTrackBuffer = async (
  track: trackType,
  quality: number,
  options: Omit<StreamTrackOptions, 'resumeFrom'> = {},
): Promise<Buffer | null> => {
  let ts: TrackStream;
  try {
    ts = await streamTrackDownload(track, quality, {onProgress: options.onProgress, session: options.session});
  } catch (err) {
    if (err instanceof Error && /unavailable at quality/.test(err.message)) {
      return null;
    }
    throw err;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of ts.stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};
