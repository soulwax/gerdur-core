import {getBuffer} from '../lib/http';
import {getTrackInfoPublicApi} from './api';
import type {trackType} from '../types';

export interface TrackPreview {
  /** direct URL to a ~30 s MP3 clip — no licence, no encryption, no `arl` */
  url: string;
  /** clip length in seconds (Deezer previews are 30 s) */
  duration: number;
}

/**
 * The 30-second preview clip for a track. Deezer exposes it two ways:
 * `song.getData` carries it in `MEDIA` (`{TYPE: 'preview', HREF}`), and the
 * public `/track/` endpoint carries it as `preview`. Pass a gw `track` object
 * (uses `MEDIA`, no extra request) or a track id (one public-API lookup).
 *
 * The clip is a plain MP3 — never Blowfish-encrypted — so it needs no
 * `decryptDownload` and is safe to use in tests and "audition before download"
 * flows.
 */
export const getTrackPreview = async (track: trackType | string | number): Promise<TrackPreview | null> => {
  if (typeof track === 'object') {
    const media = track.MEDIA?.[0];
    if (media?.HREF && (!media.TYPE || media.TYPE === 'preview')) {
      return {url: media.HREF, duration: 30};
    }
    const pub = await getTrackInfoPublicApi(track.SNG_ID);
    return pub.preview ? {url: pub.preview, duration: 30} : null;
  }

  const pub = await getTrackInfoPublicApi(String(track));
  return pub.preview ? {url: pub.preview, duration: 30} : null;
};

/** Fetch the 30-second preview clip as a `Buffer` (plain MP3, no decryption needed). */
export const downloadPreview = async (track: trackType | string | number): Promise<Buffer | null> => {
  const preview = await getTrackPreview(track);
  if (!preview) return null;
  return getBuffer(preview.url);
};
