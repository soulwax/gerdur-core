import {PoliteJsonClient} from './client';

const DEFAULT_UA = 'gerdur-core (+https://github.com/soulwax/gerdur-core)';

let client = new PoliteJsonClient({userAgent: DEFAULT_UA, minIntervalMs: 1100});

/**
 * Set the `User-Agent` (MusicBrainz requires a descriptive one that identifies
 * your application and a contact URL/email) and the minimum request interval
 * (they ask for ≤ 1 req/s per IP; default 1100 ms). Call once at startup.
 */
export const configureMusicBrainz = (opts: {userAgent?: string; minIntervalMs?: number}): void => {
  client = new PoliteJsonClient({
    userAgent: opts.userAgent ?? client.userAgent,
    minIntervalMs: opts.minIntervalMs ?? client.minIntervalMs,
  });
};

const BASE = 'https://musicbrainz.org/ws/2';

export interface MBArtistCredit {
  name: string;
  mbid?: string;
  /** text that joins this credit to the next, e.g. `' feat. '` */
  joinPhrase?: string;
}

export interface MBRelease {
  mbid: string;
  title: string;
  /** YYYY / YYYY-MM / YYYY-MM-DD */
  date?: string;
  /** ISO 3166 country code */
  country?: string;
  status?: string;
  barcode?: string;
  releaseGroupMbid?: string;
  primaryType?: string;
  /** first label + catalogue number, when a full release lookup was done */
  label?: string;
  catalogNumber?: string;
}

export interface MBRecording {
  mbid: string;
  title: string;
  disambiguation?: string;
  /** track length in milliseconds */
  lengthMs?: number;
  /** every ISRC MusicBrainz has for this recording */
  isrcs: string[];
  /** search relevance 0–100 */
  score?: number;
  artistCredit: MBArtistCredit[];
  /** the artist credit rendered as one display string */
  artist: string;
  /** earliest release date across the releases MB returned */
  firstReleaseDate?: string;
  releases: MBRelease[];
}

const renderCredit = (credits: MBArtistCredit[]): string =>
  credits.map((c, i) => c.name + (i < credits.length - 1 ? c.joinPhrase ?? ', ' : '')).join('');

const mapCredit = (raw: any[]): MBArtistCredit[] =>
  (raw ?? []).map((c) => ({
    name: c.name ?? c.artist?.name,
    mbid: c.artist?.id,
    joinPhrase: c.joinphrase || undefined,
  }));

const mapRelease = (r: any): MBRelease => ({
  mbid: r.id,
  title: r.title,
  date: r.date || undefined,
  country: r.country || undefined,
  status: r.status || undefined,
  barcode: r.barcode || undefined,
  releaseGroupMbid: r['release-group']?.id,
  primaryType: r['release-group']?.['primary-type'] || undefined,
  label: r['label-info']?.[0]?.label?.name,
  catalogNumber: r['label-info']?.[0]?.['catalog-number'] || undefined,
});

/**
 * The best-matching MusicBrainz recording for an ISRC — canonical title, artist
 * credits, length, every known ISRC, and the releases it appears on. `null` when
 * MusicBrainz has nothing for the code.
 */
export const lookupRecordingByISRC = async (isrc: string): Promise<MBRecording | null> => {
  const data = await client.get<any>(
    `${BASE}/recording?query=isrc:${encodeURIComponent(isrc)}&fmt=json&limit=5&inc=releases`,
  );
  const raw = data?.recordings?.[0];
  if (!raw) {
    return null;
  }

  const releases = (raw.releases ?? []).map(mapRelease);
  const firstReleaseDate = releases
    .map((r: MBRelease) => r.date)
    .filter(Boolean)
    .sort()[0];

  return {
    mbid: raw.id,
    title: raw.title,
    disambiguation: raw.disambiguation || undefined,
    lengthMs: typeof raw.length === 'number' ? raw.length : undefined,
    isrcs: raw.isrcs ?? [isrc],
    score: typeof raw.score === 'number' ? raw.score : undefined,
    artistCredit: mapCredit(raw['artist-credit']),
    artist: renderCredit(mapCredit(raw['artist-credit'])),
    firstReleaseDate,
    releases,
  };
};

/**
 * A full MusicBrainz release — with `inc` (default `labels`, `release-groups`)
 * you get the label, catalogue number, barcode and release-group MBID (which
 * feeds `getCoverArt`). `null` when the MBID is unknown.
 */
export const getMusicBrainzRelease = async (
  releaseMbid: string,
  inc: string[] = ['labels', 'release-groups'],
): Promise<MBRelease | null> => {
  const data = await client.get<any>(
    `${BASE}/release/${encodeURIComponent(releaseMbid)}?fmt=json&inc=${inc.join('+')}`,
  );
  return data ? mapRelease(data) : null;
};

/** Look up a recording by its own MBID (rather than by ISRC). */
export const getMusicBrainzRecording = async (recordingMbid: string): Promise<MBRecording | null> => {
  const raw = await client.get<any>(
    `${BASE}/recording/${encodeURIComponent(recordingMbid)}?fmt=json&inc=artist-credits+isrcs+releases`,
  );
  if (!raw) {
    return null;
  }
  const releases = (raw.releases ?? []).map(mapRelease);
  return {
    mbid: raw.id,
    title: raw.title,
    disambiguation: raw.disambiguation || undefined,
    lengthMs: typeof raw.length === 'number' ? raw.length : undefined,
    isrcs: raw.isrcs ?? [],
    artistCredit: mapCredit(raw['artist-credit']),
    artist: renderCredit(mapCredit(raw['artist-credit'])),
    firstReleaseDate: releases
      .map((r: MBRelease) => r.date)
      .filter(Boolean)
      .sort()[0],
    releases,
  };
};
