import {PoliteJsonClient} from './client';
import {lookupRecordingByISRC} from './musicbrainz';
import type {MBRecording} from './musicbrainz';

const client = new PoliteJsonClient({
  userAgent: 'gerdur-core (+https://github.com/soulwax/gerdur-core)',
  minIntervalMs: 200,
});

const BASE = 'https://coverartarchive.org';

export interface CoverArtImage {
  id: string;
  front: boolean;
  back: boolean;
  approved: boolean;
  /** full-resolution image URL (redirects to archive.org) */
  image: string;
  /** `{small, large, '250', '500', '1200'}` — not every size is present */
  thumbnails: Record<string, string>;
  types: string[];
}

export interface CoverArt {
  images: CoverArtImage[];
  /** the MusicBrainz release the art belongs to */
  release?: string;
}

/**
 * Cover Art Archive images for a MusicBrainz release-group (default) or release.
 * `null` when there's no art — very common, so always handle it. Feed the MBID
 * from `lookupRecordingByISRC(...).releases[i].releaseGroupMbid`.
 */
export const getCoverArt = async (
  mbid: string,
  entity: 'release' | 'release-group' = 'release-group',
): Promise<CoverArt | null> => {
  const data = await client.get<any>(`${BASE}/${entity}/${encodeURIComponent(mbid)}`);
  if (!data?.images) {
    return null;
  }
  return {
    release: data.release,
    images: data.images.map((i: any) => ({
      id: String(i.id),
      front: Boolean(i.front),
      back: Boolean(i.back),
      approved: Boolean(i.approved),
      image: i.image,
      thumbnails: i.thumbnails ?? {},
      types: i.types ?? [],
    })),
  };
};

/**
 * The single best front-cover URL — the approved front image, preferring a
 * thumbnail at least `minSize` px wide, else the full-resolution original.
 * Deezer caps its own art at 1800 px, so this is how you go bigger.
 */
export const getBestCoverArtUrl = async (
  mbid: string,
  {entity = 'release-group', minSize = 1200}: {entity?: 'release' | 'release-group'; minSize?: number} = {},
): Promise<string | null> => {
  const art = await getCoverArt(mbid, entity);
  if (!art) {
    return null;
  }
  const front = art.images.find((i) => i.front && i.approved) ?? art.images.find((i) => i.front) ?? art.images[0];
  if (!front) {
    return null;
  }
  const sized = Object.entries(front.thumbnails)
    .map(([k, url]) => [Number(k), url] as const)
    .filter(([n]) => Number.isFinite(n) && n >= minSize)
    .sort((a, b) => a[0] - b[0])[0];
  return sized ? sized[1] : front.image;
};

/** Rank a recording's releases so the canonical original album comes first. */
const rankReleases = (rec: MBRecording): string[] => {
  const seen = new Set<string>();
  return rec.releases
    .filter((r) => r.releaseGroupMbid)
    .map((r) => ({
      rgid: r.releaseGroupMbid as string,
      // Official beats Promotion/Bootleg/Pseudo-Release; Album beats Single/EP/Compilation;
      // then earliest date wins.
      score:
        (r.status === 'Official' ? 0 : r.status ? 10 : 5) + (r.primaryType === 'Album' ? 0 : r.primaryType ? 2 : 1),
      date: r.date ?? '9999',
    }))
    .sort((a, b) => a.score - b.score || a.date.localeCompare(b.date))
    .map((r) => r.rgid)
    .filter((rgid) => (seen.has(rgid) ? false : seen.add(rgid)));
};

/**
 * The best cover for a MusicBrainz recording — walks its release-groups
 * canonical-first (Official Album, earliest) and returns the first Cover Art
 * Archive front cover it finds. `null` when none of the top few have art.
 * Bounded to `maxTries` release-groups (default 4) to keep the request count low.
 */
export const getRecordingCoverArt = async (
  rec: MBRecording,
  {minSize = 1200, maxTries = 4}: {minSize?: number; maxTries?: number} = {},
): Promise<string | null> => {
  for (const rgid of rankReleases(rec).slice(0, maxTries)) {
    const url = await getBestCoverArtUrl(rgid, {entity: 'release-group', minSize});
    if (url) return url;
  }
  return null;
};

/**
 * One call: ISRC → MusicBrainz recording → best Cover Art Archive front cover
 * (larger than Deezer's 1800 px cap). `null` when there's no match or no art.
 */
export const getCoverArtByISRC = async (
  isrc: string,
  options: {minSize?: number; maxTries?: number} = {},
): Promise<string | null> => {
  const rec = await lookupRecordingByISRC(isrc);
  return rec ? getRecordingCoverArt(rec, options) : null;
};
