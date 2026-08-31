import {downloadAlbumCover, downloadArtistImage} from './abumCover';
import {getTrackLyrics} from './getTrackLyrics';
import {writeMetadataMp3} from './id3';
import {writeMetadataFlac} from './flacmetata';
import {getRichAlbum} from './rich-album';
import {buildTagModel} from './model';
import type {TrackTagModel} from './model';
import type {RichAlbum} from './rich-album';
import {getTrackInfo, getTrackInfoPublicApi} from '../api';
import type {lyricsType, trackType, trackTypePublicApi} from '../types';

export {normalizeContributors} from './contributors';
export type {NormalizedContributors} from './contributors';
export {toLrc} from './lrc';
export {getRichAlbum} from './rich-album';
export type {RichAlbum} from './rich-album';
export {buildTagModel} from './model';
export type {TrackTagModel, Person} from './model';
export {downloadAlbumCover, downloadArtistImage, MAX_COVER_SIZE} from './abumCover';
export {createTagStream, probeAudioOffset} from './tag-stream';

export interface AddTrackTagsOptions {
  /** embedded cover size in px, 56–1800 (default 1000) */
  coverSize?: number;
  /** pre-fetched album cover; skips the download when provided (`null` = none) */
  cover?: Buffer | null;
  /** pre-fetched artist image */
  artistImage?: Buffer | null;
  /** pre-fetched merged album info; skips `getRichAlbum` (fetch once per album, pass here) */
  album?: RichAlbum | null;
  /** pre-fetched lyrics (`song.getLyrics` shape); skips the lyrics fetch */
  lyrics?: lyricsType | null;
  /** pre-fetched public `/track/` payload (BPM source) */
  publicTrack?: trackTypePublicApi | null;

  /** embed front cover art. default true */
  embedCover?: boolean;
  /** embed the artist photo as a second picture. default true */
  embedArtistImage?: boolean;
  /** fetch + embed lyrics. default true */
  writeLyrics?: boolean;
  /** embed synced LRC (FLAC Vorbis comment only; MP3 has no v2.3 synced frame). default true */
  embedSyncedLyrics?: boolean;
  /**
   * hydrate `SNG_CONTRIBUTORS` / `VERSION` / `GAIN` from `song.getData` when the
   * track came from an album/playlist listing (which omits them), and pull BPM
   * from the public API. default true.
   */
  richCredits?: boolean;
  /** write `DEEZER_*_ID`, url slug, provider/label ids. default true */
  deezerIds?: boolean;
  /** write popularity rank. default true */
  includeRank?: boolean;
}

const DEFAULTS: Required<Omit<AddTrackTagsOptions, 'cover' | 'artistImage' | 'album' | 'lyrics' | 'publicTrack'>> = {
  coverSize: 1000,
  embedCover: true,
  embedArtistImage: true,
  writeLyrics: true,
  embedSyncedLyrics: true,
  richCredits: true,
  deezerIds: true,
  includeRank: true,
};

export interface TaggedTrack {
  /** the audio with tags written */
  buffer: Buffer;
  /** everything gerdur pulled together for this track — use `model.lyricsSynced` for a `.lrc` sidecar */
  model: TrackTagModel;
}

// Per-track by necessity: `SNG_CONTRIBUTORS` is exposed *only* by `song.getData`.
// Probed against the live gateway — `song.getListData` (the batch endpoint
// `refreshTrackTokens` uses) returns 44 fields including VERSION, GAIN, ISRC,
// ART_PICTURE and URL_REWRITING, but no contributors; neither does
// `song.getListByAlbum`. So a 14-track album costs 14 of these, and the only way
// to avoid them is `{richCredits: false}`, which trades away credits and BPM.
const hydrate = async (track: trackType): Promise<trackType> => {
  if (track.SNG_CONTRIBUTORS !== undefined && track.VERSION !== undefined && track.GAIN !== undefined) {
    return track;
  }
  try {
    const full = await getTrackInfo(track.SNG_ID);
    return {
      ...full,
      ...track,
      SNG_CONTRIBUTORS: full.SNG_CONTRIBUTORS ?? track.SNG_CONTRIBUTORS,
      VERSION: full.VERSION ?? track.VERSION,
      GAIN: track.GAIN ?? full.GAIN,
      RANK: track.RANK ?? full.RANK,
      URL_REWRITING: track.URL_REWRITING ?? full.URL_REWRITING,
      PROVIDER_ID: track.PROVIDER_ID ?? full.PROVIDER_ID,
      EXPLICIT_TRACK_CONTENT: track.EXPLICIT_TRACK_CONTENT ?? full.EXPLICIT_TRACK_CONTENT,
      ART_PICTURE: track.ART_PICTURE || full.ART_PICTURE,
    };
  } catch {
    return track;
  }
};

/**
 * Resolve everything Deezer has for a track into the canonical tag model —
 * without touching any audio.
 *
 * Fetches album info, lyrics, cover, artist image and (for album/playlist
 * tracks, which ship without them) full credits + BPM, all in parallel; every
 * call is memoised and in-flight-coalesced, so resolving all tracks of one album
 * hits each metadata endpoint once. Pass any of
 * `options.{album,lyrics,cover,publicTrack}` to skip the corresponding fetch.
 *
 * Feed the result to `createTagStream(model)` to tag a stream, or use
 * {@link addTrackTags} to tag a `Buffer` in one call.
 */
export const resolveTagModel = async (
  trackInput: trackType,
  options: AddTrackTagsOptions = {},
): Promise<TrackTagModel> => {
  const opt = {...DEFAULTS, ...options};

  const track = opt.richCredits ? await hydrate(trackInput) : trackInput;

  const [album, lyrics, publicTrack, cover, artistImage] = await Promise.all([
    options.album !== undefined ? Promise.resolve(options.album) : getRichAlbum(track.ALB_ID).catch(() => null),
    options.lyrics !== undefined
      ? Promise.resolve(options.lyrics)
      : opt.writeLyrics
      ? getTrackLyrics(track).catch(() => null)
      : Promise.resolve(null),
    options.publicTrack !== undefined
      ? Promise.resolve(options.publicTrack)
      : opt.richCredits
      ? getTrackInfoPublicApi(track.SNG_ID).catch(() => null)
      : Promise.resolve(null),
    options.cover !== undefined
      ? Promise.resolve(options.cover)
      : opt.embedCover
      ? downloadAlbumCover(track, opt.coverSize)
      : Promise.resolve(null),
    options.artistImage !== undefined
      ? Promise.resolve(options.artistImage)
      : opt.embedArtistImage
      ? downloadArtistImage(track).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (track.ART_NAME && track.ART_NAME.toLowerCase() === 'various') {
    track.ART_NAME = 'Various Artists';
  }

  const model = buildTagModel({
    track,
    album: album || undefined,
    publicTrack,
    lyrics,
    cover: opt.embedCover ? cover : null,
    artistImage: opt.embedArtistImage ? artistImage : null,
    coverSize: opt.coverSize,
    deezerIds: opt.deezerIds,
    includeRank: opt.includeRank,
  });

  return model;
};

/**
 * Pull together everything Deezer has for a track and write it into the audio.
 *
 * Sniffs `fLaC` vs MP3 and dispatches to the FLAC / ID3 writer. Fetches album
 * info, lyrics, cover and (for album/playlist tracks) full credits + BPM in
 * parallel — every call is memoised and in-flight-coalesced, so tagging all
 * tracks of one album hits each metadata endpoint once. Pass any of
 * `options.{album,lyrics,cover,publicTrack}` to skip the corresponding fetch.
 *
 * This holds the whole file in memory (and the tag writers allocate another
 * copy). On a server, prefer {@link resolveTagModel} + `createTagStream`, which
 * produces byte-identical output without buffering the audio.
 *
 * @returns `{buffer, model}` — `model` carries the structured metadata and,
 *   when available, `model.lyricsSynced` (an LRC document for a sidecar file).
 */
export const addTrackTags = async (
  trackBuffer: Buffer,
  trackInput: trackType,
  options: AddTrackTagsOptions = {},
): Promise<TaggedTrack> => {
  const model = await resolveTagModel(trackInput, options);
  const opt = {...DEFAULTS, ...options};

  const isFlac = trackBuffer.slice(0, 4).toString('ascii') === 'fLaC';
  const buffer = isFlac
    ? writeMetadataFlac(trackBuffer, model, {embedSyncedLyrics: opt.embedSyncedLyrics})
    : writeMetadataMp3(trackBuffer, model);

  return {buffer, model};
};
