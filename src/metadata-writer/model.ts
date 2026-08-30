import {normalizeContributors} from './contributors';
import {toLrc} from './lrc';
import type {RichAlbum} from './rich-album';
import type {lyricsType, trackType, trackTypePublicApi} from '../types';

export interface TagModelInput {
  track: trackType;
  album?: RichAlbum;
  /** public `/track/` payload — the only source of BPM */
  publicTrack?: trackTypePublicApi | null;
  lyrics?: lyricsType | null;
  cover?: Buffer | null;
  artistImage?: Buffer | null;
  coverSize: number;
  /** write `DEEZER_*_ID`, `URL_REWRITING` slug, provider/label ids */
  deezerIds: boolean;
  /** write popularity rank */
  includeRank: boolean;
}

export interface Person {
  role: string;
  name: string;
}

export interface TrackTagModel {
  title: string;
  subtitle?: string;
  album: string;
  artists: string[];
  mainArtists: string[];
  featuredArtists: string[];
  albumArtist: string;
  composers: string[];
  lyricists: string[];
  producers: string[];
  engineers: Person[];
  mixers: string[];
  performers: Person[];
  publishers: string[];

  trackNumber: number;
  trackTotal?: number;
  discNumber: number;
  discTotal?: number;

  isrc?: string;
  barcode?: string;
  durationMs: number;
  bpm?: number;

  genres: string[];
  label?: string;
  releaseType?: string;
  isCompilation: boolean;

  date?: string;
  year?: string;
  originalDate?: string;
  originalYear?: string;

  copyright?: string;
  producerLine?: string;

  replayGainTrackGain?: string;

  explicit: 'explicit' | 'clean' | 'unknown';
  itunesAdvisory: number;

  lyrics?: string;
  lyricsSynced?: string;
  lyricsWriters?: string;
  lyricsCopyright?: string;

  ids: {
    deezerTrack?: string;
    deezerAlbum?: string;
    deezerArtist?: string;
    slug?: string;
    labelId?: string;
    providerId?: string;
  };
  rank?: number;

  cover?: Buffer | null;
  coverSize: number;
  artistImage?: Buffer | null;
}

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : undefined);

const explicitFrom = (status?: number): {explicit: TrackTagModel['explicit']; itunesAdvisory: number} => {
  // Deezer EXPLICIT_LYRICS_STATUS: 0 none · 1 explicit · 2 unknown · 3 edited/clean
  //   · 4 partially-explicit · 6 no-advice · 7 partially-no-advice
  if (status === 1 || status === 4) return {explicit: 'explicit', itunesAdvisory: 1};
  if (status === 3) return {explicit: 'clean', itunesAdvisory: 2};
  return {explicit: 'unknown', itunesAdvisory: 0};
};

export const buildTagModel = (input: TagModelInput): TrackTagModel => {
  const {track, album, publicTrack, lyrics, coverSize} = input;

  const c = normalizeContributors(track.SNG_CONTRIBUTORS);

  // main artists: contributors first, else the ARTISTS[] list, else ART_NAME
  const artistsAll = (track.ARTISTS || []).map((a) => a.ART_NAME).filter(Boolean);
  const mainArtists = c.mainArtists.length ? c.mainArtists : artistsAll.length ? artistsAll : [track.ART_NAME];
  const featuredArtists = c.featuring.length ? c.featuring : artistsAll.filter((n) => !mainArtists.includes(n));
  const artists = [...new Set([...mainArtists, ...featuredArtists])];

  const albMeta = album || ({genres: [], isCompilation: false, isLive: false} as unknown as RichAlbum);
  const isCompilation = albMeta.isCompilation || /^various/i.test(track.ART_NAME);

  const date =
    albMeta.releaseDate ||
    (publicTrack?.release_date && /^\d{4}-\d{2}-\d{2}$/.test(publicTrack.release_date)
      ? publicTrack.release_date
      : undefined);
  const originalDate = albMeta.originalDate && albMeta.originalDate !== date ? albMeta.originalDate : undefined;

  const gain = parseFloat(track.GAIN ?? publicTrack?.gain?.toString() ?? '');
  const bpmRaw = publicTrack?.bpm ?? 0;

  const explicit = explicitFrom(track.EXPLICIT_TRACK_CONTENT?.EXPLICIT_LYRICS_STATUS);

  let releaseType: string | undefined = albMeta.recordType;
  if (albMeta.isLive) releaseType = 'live';
  else if (isCompilation) releaseType = 'compilation';

  const version = (track.VERSION || publicTrack?.title_version || '').trim();

  return {
    title: track.SNG_TITLE,
    subtitle: version || undefined,
    album: track.ALB_TITLE || albMeta.title,
    artists,
    mainArtists,
    featuredArtists,
    albumArtist: albMeta.albumArtist || track.ART_NAME,
    composers: c.composers,
    lyricists: c.lyricists,
    producers: c.producers,
    engineers: c.engineers,
    mixers: c.mixers,
    performers: c.performers,
    publishers: c.publishers,

    trackNumber: Number(track.TRACK_NUMBER) || 0,
    trackTotal: albMeta.trackTotal,
    discNumber: Number(track.DISK_NUMBER) || 1,
    discTotal: albMeta.discTotal,

    isrc: track.ISRC || publicTrack?.isrc || undefined,
    barcode: albMeta.upc,
    durationMs: (Number(track.DURATION) || 0) * 1000,
    bpm: bpmRaw > 0 ? bpmRaw : undefined,

    genres: albMeta.genres || [],
    label: albMeta.label,
    releaseType,
    isCompilation,

    date,
    year: yearOf(date),
    originalDate,
    originalYear: yearOf(originalDate),

    copyright: albMeta.copyright,
    producerLine: albMeta.producerLine,

    replayGainTrackGain: Number.isFinite(gain) ? `${gain.toFixed(2)} dB` : undefined,

    explicit: explicit.explicit,
    itunesAdvisory: explicit.itunesAdvisory,

    lyrics: lyrics?.LYRICS_TEXT || undefined,
    lyricsSynced:
      toLrc(lyrics?.LYRICS_SYNC_JSON, {
        title: track.SNG_TITLE,
        artist: mainArtists.join(', '),
        album: track.ALB_TITLE,
        writers: lyrics?.LYRICS_WRITERS,
        length: Number(track.DURATION) || undefined,
      }) || undefined,
    lyricsWriters: lyrics?.LYRICS_WRITERS || undefined,
    lyricsCopyright: lyrics?.LYRICS_COPYRIGHTS || undefined,

    ids: input.deezerIds
      ? {
          deezerTrack: track.SNG_ID,
          deezerAlbum: track.ALB_ID,
          deezerArtist: track.ART_ID,
          slug: track.URL_REWRITING || undefined,
          labelId: albMeta.labelId,
          providerId: track.PROVIDER_ID || undefined,
        }
      : {},
    rank: input.includeRank && track.RANK ? Number(track.RANK) || undefined : undefined,

    cover: input.cover,
    coverSize,
    artistImage: input.artistImage,
  };
};
