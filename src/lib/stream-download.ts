import {PassThrough, Readable} from 'stream';
import {createDecryptStream} from './decrypt';
import {getStream} from './http';
import {getTrackDownloadUrl} from './get-url';
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
  const resolved = await getTrackDownloadUrl(track, quality);
  if (!resolved) {
    throw new Error(`Track ${track.SNG_ID} is unavailable at quality ${quality}`);
  }

  const startedAt = options.resumeFrom ? Math.floor(options.resumeFrom / CHUNK) * CHUNK : 0;
  const {stream: raw, headers} = await getStream(resolved.trackUrl, {rangeStart: startedAt});

  const contentLength = Number(headers['content-length']) || 0;
  const size = resolved.fileSize || (contentLength ? contentLength + startedAt : 0);

  let received = startedAt;
  if (options.onProgress) {
    const meter = new PassThrough();
    raw.on('data', (c: Buffer) => {
      received += c.length;
      options.onProgress?.(received, size);
    });
    raw.pipe(meter);
    return {
      stream: resolved.isEncrypted ? meter.pipe(createDecryptStream(track.SNG_ID, startedAt / CHUNK)) : meter,
      size,
      startedAt,
      isEncrypted: resolved.isEncrypted,
    };
  }

  return {
    stream: resolved.isEncrypted ? raw.pipe(createDecryptStream(track.SNG_ID, startedAt / CHUNK)) : raw,
    size,
    startedAt,
    isEncrypted: resolved.isEncrypted,
  };
};
