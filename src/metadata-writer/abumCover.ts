import FastLRU from '../lib/fast-lru';
import {getBuffer} from '../lib/http';
import type {trackType} from '../types';

// Deezer serves cover art up to 1800x1800; larger sizes 403.
export type coverSize = 56 | 250 | 500 | 1000 | 1200 | 1500 | 1800 | number;

export const MAX_COVER_SIZE = 1800;

// expire cache in 30 minutes
const lru = new FastLRU({
  maxSize: 50,
  ttl: 30 * 60000,
});

const clampSize = (n: number): number => Math.max(56, Math.min(MAX_COVER_SIZE, Math.round(n) || 500));

const imageUrl = (kind: 'cover' | 'artist', md5: string, size: number) =>
  `https://e-cdns-images.dzcdn.net/images/${kind}/${md5}/${size}x${size}-000000-80-0-0.jpg`;

const fetchImage = async (kind: 'cover' | 'artist', md5: string | undefined, size: number): Promise<Buffer | null> => {
  if (!md5) {
    return null;
  }
  const px = clampSize(size);
  const key = `${kind}:${md5}:${px}`;
  const cached = lru.get(key);
  if (cached) {
    return cached as Buffer;
  }
  try {
    const data = await getBuffer(imageUrl(kind, md5, px));
    lru.set(key, data);
    return data;
  } catch (err) {
    return null;
  }
};

/**
 * @param track track info json from deezer api
 * @param albumCoverSize in pixels, 56–1800 (clamped)
 */
export const downloadAlbumCover = (track: trackType, albumCoverSize: coverSize): Promise<Buffer | null> =>
  fetchImage('cover', track.ALB_PICTURE, albumCoverSize);

/**
 * Artist photo (`ART_PICTURE` md5). Returns null when the track has no artist
 * image (common for small-catalogue artists).
 */
export const downloadArtistImage = (track: trackType, size: coverSize = 1000): Promise<Buffer | null> => {
  const md5 = track.ART_PICTURE || track.ARTISTS?.find((a) => a.ART_PICTURE)?.ART_PICTURE;
  return fetchImage('artist', md5, size);
};
