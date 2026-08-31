import {PoliteJsonClient} from './client';

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
