/**
 * Download methods on {@link Session}, kept in a separate module so `session.ts`
 * doesn't have to import the download stack (which imports `session.ts` back).
 * `import`ing this file for its side effect wires the methods onto the prototype;
 * `src/index.ts` does that.
 */
import {getTrackDownloadUrl, refreshTrackTokens, resolveDownloadUrls} from './get-url';
import type {Quality, ResolvedUrl} from './get-url';
import {Session} from './session';
import {downloadTrackBuffer, streamTrackDownload} from './stream-download';
import type {StreamTrackOptions, TrackStream} from './stream-download';
import type {trackType} from '../types';

declare module './session' {
  interface Session {
    /** Resolve a downloadable URL for a track **as this account** (`1 | 3 | 9`). */
    getTrackDownloadUrl(
      track: trackType,
      quality: number,
    ): Promise<{trackUrl: string; isEncrypted: boolean; fileSize: number} | null>;
    /** Batch-resolve download URLs for many tracks in one request, as this account. */
    resolveDownloadUrls(tracks: trackType[], qualities?: Quality[]): Promise<(ResolvedUrl | null)[]>;
    /** Download a track as a constant-memory stream of decrypted audio, as this account. */
    streamTrack(track: trackType, quality: number, options?: Omit<StreamTrackOptions, 'session'>): Promise<TrackStream>;
    /** Download + decrypt a track fully into a `Buffer`, as this account. */
    getTrackBuffer(
      track: trackType,
      quality: number,
      options?: Omit<StreamTrackOptions, 'session' | 'resumeFrom'>,
    ): Promise<Buffer | null>;
    /** Batch-refresh the `TRACK_TOKEN`s on these tracks (as this account) before a long download. */
    refreshTrackTokens(tracks: trackType[], graceSeconds?: number): Promise<trackType[]>;
  }
}

Session.prototype.getTrackDownloadUrl = function (track, quality) {
  return getTrackDownloadUrl(track, quality, this);
};

Session.prototype.resolveDownloadUrls = function (tracks, qualities) {
  return resolveDownloadUrls(tracks, qualities, this);
};

Session.prototype.streamTrack = function (track, quality, options = {}) {
  return streamTrackDownload(track, quality, {...options, session: this});
};

Session.prototype.getTrackBuffer = function (track, quality, options = {}) {
  return downloadTrackBuffer(track, quality, {...options, session: this});
};

Session.prototype.refreshTrackTokens = function (tracks, graceSeconds) {
  return refreshTrackTokens(tracks, {graceSeconds, session: this});
};
