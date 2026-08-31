import {requestPublicApi} from './request';
import type {
  albumTypePublicApi,
  artistAlbumResult,
  chartType,
  editorialType,
  genreType,
  publicApiList,
  searchResultArtist,
  searchResultPlaylist,
  searchResultTrack,
  trackTypePublicApi,
} from '../types';

const withParams = (slug: string, params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${slug}?${qs}` : slug;
};

// ─── Charts ──────────────────────────────────────────────────────────────────

/**
 * The five ranked lists Deezer publishes for a genre: `tracks`, `albums`,
 * `artists`, `playlists`, `podcasts`. `genreId` `0` (the default) is "all
 * genres"; other ids come from {@link getGenres}.
 */
export const getChart = (genreId: number | string = 0, limit = 10): Promise<chartType> =>
  requestPublicApi(withParams(`/chart/${genreId}`, {limit}));

/** Just the track chart for a genre (`0` = all). Handy as a ready-to-play list. */
export const getChartTracks = (
  genreId: number | string = 0,
  limit = 100,
  index = 0,
): Promise<publicApiList<searchResultTrack & {position: number}>> =>
  requestPublicApi(withParams(`/chart/${genreId}/tracks`, {limit, index}));

// ─── Genres & editorial ──────────────────────────────────────────────────────

/** Deezer's genre list — the `id`s feed {@link getChart}, {@link getGenreArtists}, advanced search. */
export const getGenres = (): Promise<publicApiList<genreType>> => requestPublicApi('/genre');

/** Artists Deezer files under a genre. */
export const getGenreArtists = (genreId: number | string): Promise<publicApiList<searchResultArtist>> =>
  requestPublicApi(`/genre/${genreId}/artists`);

/** Deezer's editorial sections (the `id`s feed {@link getEditorialReleases} / {@link getEditorialSelection}). */
export const getEditorialList = (): Promise<publicApiList<editorialType>> => requestPublicApi('/editorial');

/** New releases for an editorial section (`0` = the default section). */
export const getEditorialReleases = (
  editorialId: number | string = 0,
  limit = 25,
  index = 0,
): Promise<publicApiList<artistAlbumResult>> =>
  requestPublicApi(withParams(`/editorial/${editorialId}/releases`, {limit, index}));

/** The albums Deezer's editors are currently pushing for a section. */
export const getEditorialSelection = (editorialId: number | string = 0): Promise<publicApiList<artistAlbumResult>> =>
  requestPublicApi(`/editorial/${editorialId}/selection`);

/** The editorial charts for a section — same five-list shape as {@link getChart}. */
export const getEditorialCharts = (editorialId: number | string = 0): Promise<chartType> =>
  requestPublicApi(`/editorial/${editorialId}/charts`);

// ─── Artist discovery ────────────────────────────────────────────────────────

/** An artist's most popular tracks. */
export const getArtistTopTracks = (artistId: number | string, limit = 50): Promise<publicApiList<searchResultTrack>> =>
  requestPublicApi(withParams(`/artist/${artistId}/top`, {limit}));

/** Artists Deezer considers related / similar. */
export const getRelatedArtists = (artistId: number | string, limit = 20): Promise<publicApiList<searchResultArtist>> =>
  requestPublicApi(withParams(`/artist/${artistId}/related`, {limit}));

/** An artist's discography (public-API album shape). */
export const getArtistAlbums = (
  artistId: number | string,
  limit = 50,
  index = 0,
): Promise<publicApiList<artistAlbumResult>> =>
  requestPublicApi(withParams(`/artist/${artistId}/albums`, {limit, index}));

/** Playlists featuring an artist. */
export const getArtistPlaylists = (
  artistId: number | string,
  limit = 25,
): Promise<publicApiList<searchResultPlaylist>> =>
  requestPublicApi(withParams(`/artist/${artistId}/playlists`, {limit}));

/** A ready-made radio (track list) seeded from an artist. */
export const getArtistRadioTracks = (artistId: number | string): Promise<publicApiList<searchResultTrack>> =>
  requestPublicApi(`/artist/${artistId}/radio`);

// ─── ISRC / UPC resolution ───────────────────────────────────────────────────

/**
 * Resolve an ISRC to the Deezer **public-API** track (with `bpm`, `gain`,
 * `isrc`, `preview`, `contributors`). Unlike the converter's `isrc2deezer`, this
 * does not hydrate a gw track — pass `result.id` to `getTrackInfo` for that.
 *
 * @throws when Deezer has no track for the code
 */
export const getTrackByISRC = (isrc: string): Promise<trackTypePublicApi> =>
  requestPublicApi(`/track/isrc:${encodeURIComponent(isrc)}`);

/**
 * Resolve a UPC / EAN barcode to the Deezer **public-API** album (with its
 * `tracks`). A 13-digit barcode with a leading `0` is trimmed to 12, matching
 * Deezer's own lookup.
 *
 * @throws when Deezer has no album for the code
 */
export const getAlbumByUPC = (upc: string): Promise<albumTypePublicApi> => {
  const code = upc.length > 12 && upc.startsWith('0') ? upc.slice(-12) : upc;
  return requestPublicApi(`/album/upc:${encodeURIComponent(code)}`);
};
