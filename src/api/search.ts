import {requestLight, requestPublicApi} from './request';
import type {
  advancedSearchFilters,
  publicApiSearchOptions,
  publicApiSearchResponse,
  searchEntity,
  searchResultAlbum,
  searchResultArtist,
  searchResultPlaylist,
  searchResultTrack,
  suggestResult,
} from '../types';

/**
 * Compose Deezer's advanced search operators into one query string.
 *
 * ```ts
 * buildAdvancedQuery({artist: 'daft punk', durMin: 200, durMax: 400});
 * // => 'artist:"daft punk" dur_min:200 dur_max:400'
 * ```
 *
 * Free-text `query` is emitted first and bare. Deezer treats the operators as
 * ranking hints rather than hard filters (and honours `track:` only now and
 * then) — this only builds the string their docs describe. Pair it with
 * `searchPublicApi(query, {strict: true})` to tighten what Deezer allows.
 *
 * The operators are reliable only on the **track** index (`searchPublicApi` /
 * `searchTracks`). `/search/album` and `/search/artist` ignore or mishandle
 * `artist:` / `album:` — use a plain string there.
 */
export const buildAdvancedQuery = (filters: advancedSearchFilters): string => {
  const {query, artist, album, track, label, durMin, durMax, bpmMin, bpmMax} = filters;
  const parts: string[] = [];

  if (query && query.trim()) {
    parts.push(query.trim());
  }

  const textOps: [string, string | undefined][] = [
    ['artist', artist],
    ['album', album],
    ['track', track],
    ['label', label],
  ];
  for (const [op, value] of textOps) {
    if (value && value.trim()) {
      parts.push(`${op}:"${value.trim().replace(/"/g, '')}"`);
    }
  }

  const rangeOps: [string, number | undefined][] = [
    ['dur_min', durMin],
    ['dur_max', durMax],
    ['bpm_min', bpmMin],
    ['bpm_max', bpmMax],
  ];
  for (const [op, value] of rangeOps) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      parts.push(`${op}:${Math.round(value)}`);
    }
  }

  return parts.join(' ');
};

const SEARCH_ENTITIES: readonly searchEntity[] = ['track', 'album', 'artist', 'playlist', 'user', 'radio', 'podcast'];

/**
 * Search the **public** Deezer REST API (`api.deezer.com/search`).
 *
 * Unlike `searchMusic` (which drives the internal `deezer.pageSearch` gateway),
 * this returns clean public-API objects — with `isrc`, `preview`, `rank`, real
 * numeric ids — and accepts the advanced query operators (see
 * `buildAdvancedQuery`), an `order`, and `limit` / `index` paging. No auth
 * required; results are memoised by the api layer.
 *
 * @param query a plain string, or the output of `buildAdvancedQuery`
 * @param options `type` (`'track'` default), `order`, `strict`, `limit`, `index`
 */
export const searchPublicApi = <T = searchResultTrack>(
  query: string,
  options: publicApiSearchOptions = {},
): Promise<publicApiSearchResponse<T>> => {
  const {type, order, strict, limit, index} = options;
  const segment = type && type !== 'track' && SEARCH_ENTITIES.includes(type) ? `/${type}` : '';

  const search = new URLSearchParams({q: query});
  if (strict) {
    search.set('strict', 'on');
  }
  if (order) {
    search.set('order', order);
  }
  if (typeof limit === 'number') {
    search.set('limit', String(limit));
  }
  if (typeof index === 'number') {
    search.set('index', String(index));
  }

  return requestPublicApi(`/search${segment}?${search.toString()}`);
};

/** `searchPublicApi` fixed to tracks. */
export const searchTracks = (
  query: string,
  options: Omit<publicApiSearchOptions, 'type'> = {},
): Promise<publicApiSearchResponse<searchResultTrack>> =>
  searchPublicApi<searchResultTrack>(query, {...options, type: 'track'});

/** `searchPublicApi` fixed to albums. */
export const searchAlbums = (
  query: string,
  options: Omit<publicApiSearchOptions, 'type'> = {},
): Promise<publicApiSearchResponse<searchResultAlbum>> =>
  searchPublicApi<searchResultAlbum>(query, {...options, type: 'album'});

/** `searchPublicApi` fixed to artists. */
export const searchArtists = (
  query: string,
  options: Omit<publicApiSearchOptions, 'type'> = {},
): Promise<publicApiSearchResponse<searchResultArtist>> =>
  searchPublicApi<searchResultArtist>(query, {...options, type: 'artist'});

/** `searchPublicApi` fixed to playlists. */
export const searchPlaylists = (
  query: string,
  options: Omit<publicApiSearchOptions, 'type'> = {},
): Promise<publicApiSearchResponse<searchResultPlaylist>> =>
  searchPublicApi<searchResultPlaylist>(query, {...options, type: 'playlist'});

/**
 * `deezer.suggest` — the internal autocomplete endpoint. Cheaper and faster than
 * a full `searchMusic`, and it powers "as you type" suggestion UIs. Needs an
 * initialised session (`initDeezerApi`), like every gateway call.
 *
 * @param query partial query text
 * @param nb    max items per type (default 5)
 */
export const suggest = (query: string, nb = 5): Promise<suggestResult> =>
  requestLight(
    {
      QUERY: query,
      NB: nb,
      TYPES: {ALBUM: true, ARTIST: true, TRACK: true, PLAYLIST: true, RADIO: true, SHOW: true},
    },
    'deezer.suggest',
  );
