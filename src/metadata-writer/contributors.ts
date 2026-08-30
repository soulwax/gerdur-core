import type {sngContributors} from '../types';

export interface NormalizedContributors {
  /** billed / lead artists */
  mainArtists: string[];
  /** "feat." artists */
  featuring: string[];
  composers: string[];
  /** author / writer / lyricist, de-duplicated */
  lyricists: string[];
  producers: string[];
  /** {role, name} for mastering / mixing / recording (+ "second") engineers */
  engineers: {role: string; name: string}[];
  mixers: string[];
  /** other performers Deezer credits by role, e.g. background vocalist */
  performers: {role: string; name: string}[];
  publishers: string[];
}

/** collapse `Music Publisher`, `music_publisher`, `musicpublisher` → `musicpublisher` */
const canon = (key: string) => key.toLowerCase().replace(/[\s_-]+/g, '');

const ENGINEER_LABELS: {[canonKey: string]: string} = {
  masteringengineer: 'mastering engineer',
  mixingengineer: 'mixing engineer',
  recordingengineer: 'recording engineer',
  recordingsecondengineer: 'assistant recording engineer',
  assistantengineer: 'assistant engineer',
  engineer: 'engineer',
  studiopersonnel: 'engineer',
};

const uniq = (arr: string[]) => [...new Set(arr.filter((x) => x && x.trim()))].map((x) => x.trim());

/**
 * Turn Deezer's inconsistent `SNG_CONTRIBUTORS` bag into a stable shape.
 *
 * The role keys vary across the catalogue (`main_artist` / `mainartist` /
 * `artist`, `musicpublisher` / `music publisher`, …) and the value is
 * occasionally an empty array — this hides all of that.
 */
export const normalizeContributors = (raw: sngContributors | undefined): NormalizedContributors => {
  const out: NormalizedContributors = {
    mainArtists: [],
    featuring: [],
    composers: [],
    lyricists: [],
    producers: [],
    engineers: [],
    mixers: [],
    performers: [],
    publishers: [],
  };
  if (!raw || Array.isArray(raw)) {
    return out;
  }

  const bucket: {[canonKey: string]: string[]} = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const k = canon(key);
    bucket[k] = (bucket[k] || []).concat(value);
  }

  out.mainArtists = uniq([...(bucket.mainartist || []), ...(bucket.artist || [])]);
  out.featuring = uniq([...(bucket.featuring || []), ...(bucket.featuredartist || []), ...(bucket.feat || [])]);
  out.composers = uniq(bucket.composer || []);
  out.lyricists = uniq([
    ...(bucket.author || []),
    ...(bucket.writer || []),
    ...(bucket.lyricist || []),
    ...(bucket.songwriter || []),
  ]);
  out.producers = uniq([...(bucket.producer || []), ...(bucket.coproducer || []), ...(bucket.executiveproducer || [])]);
  out.mixers = uniq([...(bucket.mixer || []), ...(bucket.remixer || [])]);
  out.publishers = uniq([
    ...(bucket.publisher || []),
    ...(bucket.musicpublisher || []),
    ...(bucket.originalpublisher || []),
  ]);

  for (const [canonKey, label] of Object.entries(ENGINEER_LABELS)) {
    for (const name of uniq(bucket[canonKey] || [])) {
      out.engineers.push({role: label, name});
    }
  }

  for (const [canonKey, names] of Object.entries(bucket)) {
    if (
      canonKey === 'mainartist' ||
      canonKey === 'artist' ||
      canonKey === 'featuring' ||
      canonKey === 'composer' ||
      canonKey === 'mixer' ||
      canonKey === 'producer' ||
      canonKey in ENGINEER_LABELS ||
      /publisher|author|writer|lyricist/.test(canonKey)
    ) {
      continue;
    }
    // remaining roles: vocalist, backgroundvocalist, instruments, arranger, …
    const role = canonKey.replace(/([a-z])([A-Z])/g, '$1 $2');
    for (const name of uniq(names)) {
      out.performers.push({role, name});
    }
  }

  return out;
};
