import delay from 'delay';
import {getSongFileName} from '../lib/decrypt';
import {headRequest, HttpStatusError} from '../lib/http';
import instance from '../lib/request';
import type {trackType} from '../types';

interface userData {
  license_token: string;
  can_stream_lossless: boolean;
  can_stream_hq: boolean;
  country: string;
}

export class WrongLicense extends Error {
  constructor(format: string) {
    super();
    this.name = 'WrongLicense';
    this.message = `Your account can't stream ${format} tracks`;
  }
}

export class GeoBlocked extends Error {
  constructor(country: string) {
    super();
    this.name = 'GeoBlocked';
    this.message = `This track is not available in your country (${country})`;
  }
}

/**
 * The track's `TRACK_TOKEN` has expired (they last ~1 hour). Re-fetch the track
 * with `getTrackInfo(SNG_ID)` for a fresh token and retry.
 */
export class ExpiredTrackToken extends Error {
  constructor(public readonly sngId: string) {
    super(`Track token for ${sngId} has expired — re-fetch the track and retry`);
    this.name = 'ExpiredTrackToken';
  }
}

let user_data: userData | null = null;

/**
 * Every audio format Deezer's `get_url` understands, best → worst. `FLAC`,
 * `MP3_320` and `MP3_128` are the classic `9 / 3 / 1` qualities; the rest are
 * additional tiers (`MP3_256`, `MP3_64`, the `AAC_64` / `MP4_RA*` HE-AAC ladder)
 * that some accounts and regions expose.
 */
export const DEEZER_FORMATS = [
  'FLAC',
  'MP3_320',
  'MP3_256',
  'MP3_128',
  'MP3_64',
  'AAC_64',
  'MP4_RA3',
  'MP4_RA2',
  'MP4_RA1',
] as const;

export type DeezerFormat = (typeof DEEZER_FORMATS)[number];

/** A quality request: the numeric `1 | 3 | 9` shorthand, or any format string. */
export type Quality = number | DeezerFormat | string;

const FORMAT_FILESIZE_KEY: Record<string, keyof trackType> = {
  FLAC: 'FILESIZE_FLAC',
  MP3_320: 'FILESIZE_MP3_320',
  MP3_256: 'FILESIZE_MP3_256',
  MP3_128: 'FILESIZE_MP3_128',
  MP3_64: 'FILESIZE_MP3_64',
  MP3_MISC: 'FILESIZE_MP3_MISC' as keyof trackType,
  AAC_64: 'FILESIZE_AAC_64',
  MP4_RA1: 'FILESIZE_MP4_RA1',
  MP4_RA2: 'FILESIZE_MP4_RA2',
  MP4_RA3: 'FILESIZE_MP4_RA3',
};

const NUMERIC_FORMAT: Record<number, DeezerFormat> = {9: 'FLAC', 3: 'MP3_320', 1: 'MP3_128'};

/** Normalise a {@link Quality} (number shorthand or format string) to a format string. */
export const toFormat = (quality: Quality): string => {
  if (typeof quality === 'number') {
    const f = NUMERIC_FORMAT[quality];
    if (!f) throw new Error(`Unknown quality ${quality}`);
    return f;
  }
  return quality;
};

const getTrackFileSize = (track: trackType, quality: Quality): number => {
  const key = FORMAT_FILESIZE_KEY[toFormat(quality)];
  return key ? Number((track as any)[key]) || 0 : 0;
};

const dzAuthenticate = async (): Promise<userData> => {
  const {data} = await instance.get<any>('https://www.deezer.com/ajax/gw-light.php', {
    params: {
      method: 'deezer.getUserData',
      api_version: '1.0',
      api_token: 'null',
    },
  });
  user_data = {
    license_token: data.results.USER.OPTIONS.license_token,
    can_stream_lossless: data.results.USER.OPTIONS.web_lossless || data.results.USER.OPTIONS.mobile_loseless,
    can_stream_hq: data.results.USER.OPTIONS.web_hq || data.results.USER.OPTIONS.mobile_hq,
    country: data.results.COUNTRY,
  };
  return user_data;
};

const MEDIA_MAX_RETRIES = 3;

/**
 * Quality code (`1 | 3 | 9`) or format string → the `format` string the media
 * API expects. Format strings pass straight through, so this doubles as a
 * validator-free identity for `'AAC_64'`, `'MP3_256'`, …
 */
export const formatName = (quality: Quality): string => toFormat(quality);

/** POST media.deezer.com/v1/get_url with re-auth + exponential-backoff retry on 403/429/5xx. */
const mediaGetUrl = async (
  track_tokens: string[],
  formats: {format: string; cipher: 'BF_CBC_STRIPE' | 'NONE'}[],
  attempt = 0,
): Promise<{data: any[]; country: string}> => {
  const user = user_data ? user_data : await dzAuthenticate();
  try {
    const {data} = await instance.post<any>('https://media.deezer.com/v1/get_url', {
      license_token: user.license_token,
      media: [{type: 'FULL', formats}],
      track_tokens,
    });
    return {data: data.data ?? [], country: user.country};
  } catch (err) {
    const status = err instanceof HttpStatusError ? err.statusCode : 0;
    if ((status === 403 || status === 429 || status >= 500) && attempt < MEDIA_MAX_RETRIES) {
      user_data = null;
      await delay(500 * 2 ** attempt + Math.floor(Math.random() * 250));
      return mediaGetUrl(track_tokens, formats, attempt + 1);
    }
    throw err;
  }
};

/** Parse one `data[i]` entry from a get_url response into a source URL (or null / throw). */
const parseMediaEntry = (
  entry: any,
  token: string,
  country: string,
): {url: string; format: string; cipher: string} | null => {
  if (entry?.errors) {
    const {code} = entry.errors[0];
    if (code === 2002) throw new GeoBlocked(country);
    if (code === 2000 || code === 2001) throw new ExpiredTrackToken(token);
    throw new Error(Object.entries(entry.errors[0]).join(', '));
  }
  const media = entry?.media?.[0];
  if (!media?.sources?.length) return null;
  return {url: media.sources[0].url, format: media.format, cipher: media.cipher?.type ?? 'BF_CBC_STRIPE'};
};

/** Whether a track fetched with the given cipher needs Blowfish stripe decryption. */
const cipherIsEncrypted = (cipher: string | undefined, url: string): boolean =>
  cipher ? cipher !== 'NONE' : url.includes('/mobile/') || url.includes('/media/');

const getTrackUrlFromServer = async (
  track_token: string,
  format: string,
): Promise<{url: string; format: string; cipher: string} | null> => {
  const user = user_data ? user_data : await dzAuthenticate();
  if ((format === 'FLAC' && !user.can_stream_lossless) || (format === 'MP3_320' && !user.can_stream_hq)) {
    throw new WrongLicense(format);
  }
  const {data, country} = await mediaGetUrl([track_token], [{format, cipher: 'BF_CBC_STRIPE'}]);
  if (!data.length) return null;
  return parseMediaEntry(data[0], track_token, country);
};

/**
 * @param track Track info json returned from `getTrackInfo`
 * @param quality 1 = 128kbps, 3 = 320kbps and 9 = flac (around 1411kbps)
 */
export const getTrackDownloadUrl = async (
  track: trackType,
  quality: number,
): Promise<{trackUrl: string; isEncrypted: boolean; fileSize: number} | null> => {
  let wrongLicense: WrongLicense | null = null;
  let geoBlocked: GeoBlocked | null = null;
  let expiredToken: ExpiredTrackToken | null = null;
  let mediaBlocked: HttpStatusError | null = null;
  const format = formatName(quality);

  // Track tokens last ~1 hour. If it's already stale, skip the doomed media API
  // call and go straight to the token-free fallback below.
  const tokenStale = Boolean(track.TRACK_TOKEN_EXPIRE && track.TRACK_TOKEN_EXPIRE * 1000 < Date.now());
  if (tokenStale) {
    expiredToken = new ExpiredTrackToken(track.SNG_ID);
  } else {
    // Get URL with the official API
    try {
      const resolved = await getTrackUrlFromServer(track.TRACK_TOKEN, format);
      if (resolved) {
        return {
          trackUrl: resolved.url,
          isEncrypted: cipherIsEncrypted(resolved.cipher, resolved.url),
          fileSize: getTrackFileSize(track, quality),
        };
      }
    } catch (err) {
      if (err instanceof WrongLicense) {
        wrongLicense = err;
      } else if (err instanceof GeoBlocked) {
        geoBlocked = err;
      } else if (err instanceof ExpiredTrackToken) {
        expiredToken = err;
      } else if (err instanceof HttpStatusError && (err.statusCode === 403 || err.statusCode === 429)) {
        // media API is throttling this account — try the token-free legacy CDN below
        mediaBlocked = err;
      } else {
        throw err;
      }
    }
  }

  // Fallback to the old method
  if (track.MD5_ORIGIN) {
    const filename = getSongFileName(track, quality); // encrypted file name
    const url = `https://e-cdns-proxy-${track.MD5_ORIGIN[0]}.dzcdn.net/mobile/1/${filename}`;
    const fileSize = await testUrl(url);
    if (fileSize > 0) {
      return {
        trackUrl: url,
        isEncrypted: url.includes('/mobile/') || url.includes('/media/'),
        fileSize: fileSize,
      };
    }
  }
  if (wrongLicense) {
    throw wrongLicense;
  }
  if (geoBlocked) {
    throw geoBlocked;
  }
  if (expiredToken) {
    throw expiredToken;
  }
  if (mediaBlocked) {
    throw mediaBlocked;
  }
  return null;
};

const testUrl = async (url: string): Promise<number> => {
  try {
    const {headers} = await headRequest(url);
    return Number(headers['content-length']);
  } catch (err) {
    return 0;
  }
};

export interface ResolvedUrl {
  trackUrl: string;
  isEncrypted: boolean;
  fileSize: number;
  /** the format Deezer actually returned, e.g. `'FLAC'`, `'MP3_128'`, `'AAC_64'` */
  format: string;
  /** the cipher Deezer applied — `'BF_CBC_STRIPE'` (stripe-encrypted) or `'NONE'` */
  cipher: string;
}

/**
 * Resolve download URLs for many tracks in a **single** `get_url` request.
 *
 * `qualities` is an ordered preference list: Deezer returns the best each track
 * is licensed for, so there is no per-quality retry. Entries may be the numeric
 * `1 | 3 | 9` shorthand **or** any format string from {@link DEEZER_FORMATS}
 * (e.g. `['FLAC', 'MP3_320', 'AAC_64']`). The result has one entry per input
 * track, in order; `null` for a track that is geo-blocked, unavailable, or errored.
 *
 * @param tracks    from `getTrackInfo` / `parseInfo` (needs `TRACK_TOKEN`, `SNG_ID`, `FILESIZE_*`)
 * @param qualities preference order — default `[9, 3, 1]` (FLAC → MP3 320 → MP3 128)
 */
export const resolveDownloadUrls = async (
  tracks: trackType[],
  qualities: Quality[] = [9, 3, 1],
): Promise<(ResolvedUrl | null)[]> => {
  if (!tracks.length) return [];
  const formats = qualities.map((q) => ({format: formatName(q), cipher: 'BF_CBC_STRIPE' as const}));
  const {data, country} = await mediaGetUrl(
    tracks.map((t) => t.TRACK_TOKEN),
    formats,
  );

  return tracks.map((track, i) => {
    let parsed: {url: string; format: string; cipher: string} | null;
    try {
      parsed = parseMediaEntry(data[i], track.TRACK_TOKEN, country);
    } catch {
      // per-track error (geo-block, no rights, expired token) — skip this one
      return null;
    }
    if (!parsed) return null;
    return {
      trackUrl: parsed.url,
      isEncrypted: cipherIsEncrypted(parsed.cipher, parsed.url),
      fileSize: getTrackFileSize(track, parsed.format),
      format: parsed.format,
      cipher: parsed.cipher,
    };
  });
};
