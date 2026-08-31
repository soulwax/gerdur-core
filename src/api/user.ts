import {requestPublicApi} from './request';
import type {
  publicApiList,
  radioGenre,
  radioResult,
  searchResultTrack,
  userFavoriteAlbum,
  userFavoriteArtist,
  userFavoriteTrack,
  userPlaylistResult,
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

// ─── Flow & a user's library (public REST) ───────────────────────────────────
//
// These take an explicit `userId` (from `getUser().USER_ID`, a profile URL, or
// `parseInfo`). They read **public** profile data — a user whose library is
// private only exposes it to their own authenticated session. All memoised.

/**
 * Deezer **Flow** — the endless personalised mix — for a user. Returns
 * public-API track objects; `getTrackInfo(id)` to make one downloadable.
 */
export const getUserFlow = (userId: number | string, limit = 40): Promise<publicApiList<searchResultTrack>> =>
  requestPublicApi(withParams(`/user/${userId}/flow`, {limit}));

/** A user's favourite (loved) tracks, newest first; each carries `time_add`. */
export const getUserFavoriteTracks = (
  userId: number | string,
  limit = 100,
  index = 0,
): Promise<publicApiList<userFavoriteTrack>> => requestPublicApi(withParams(`/user/${userId}/tracks`, {limit, index}));

/** A user's favourite albums. */
export const getUserFavoriteAlbums = (
  userId: number | string,
  limit = 50,
  index = 0,
): Promise<publicApiList<userFavoriteAlbum>> => requestPublicApi(withParams(`/user/${userId}/albums`, {limit, index}));

/** A user's favourite artists. */
export const getUserFavoriteArtists = (
  userId: number | string,
  limit = 50,
  index = 0,
): Promise<publicApiList<userFavoriteArtist>> =>
  requestPublicApi(withParams(`/user/${userId}/artists`, {limit, index}));

/** A user's own + followed playlists. */
export const getUserPlaylists = (
  userId: number | string,
  limit = 50,
  index = 0,
): Promise<publicApiList<userPlaylistResult>> =>
  requestPublicApi(withParams(`/user/${userId}/playlists`, {limit, index}));

/** The radios a user has favourited. */
export const getUserRadios = (userId: number | string): Promise<publicApiList<radioResult>> =>
  requestPublicApi(`/user/${userId}/radios`);

/** A user's personal track chart (their most-played). */
export const getUserChartTracks = (userId: number | string, limit = 50): Promise<publicApiList<searchResultTrack>> =>
  requestPublicApi(withParams(`/user/${userId}/charts/tracks`, {limit}));

// ─── Radios (public REST) ────────────────────────────────────────────────────

/** Deezer's curated radio list. */
export const getRadios = (): Promise<publicApiList<radioResult>> => requestPublicApi('/radio');

/** A radio's current track list — a ready-to-play (public-API) source. */
export const getRadioTracks = (radioId: number | string): Promise<publicApiList<searchResultTrack>> =>
  requestPublicApi(`/radio/${radioId}/tracks`);

/** Radios grouped by genre. */
export const getRadioGenres = (): Promise<publicApiList<radioGenre>> => requestPublicApi('/radio/genres');
