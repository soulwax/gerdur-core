/**
 * The **logged-in account's own library**, over the authenticated gateway.
 *
 * This is not the same surface as `src/api/user.ts`. Those functions read the
 * *public* REST profile (`/user/{id}/tracks` …), which needs the profile to be
 * public and shows only what that profile exposes. These read what the account
 * itself can see — including a private library — and return gateway shapes, so
 * tracks arrive with a `TRACK_TOKEN` and are directly downloadable.
 *
 * Every response here is account-scoped, so it lives in the per-session cache
 * and is never shared between sessions.
 */
import {request} from './request';
import {getUser} from './api';
import type {playlistInfoMinimal, trackType} from '../types';

/** Envelope the gateway wraps these listings in. */
export interface GwList<T> {
  data: T[];
  count: number;
  total: number;
  filtered_count?: number;
  checksum?: string;
}

/** A favourited artist, as the library returns it. */
export interface FavoriteArtist {
  ART_ID: string;
  ART_NAME: string;
  ART_PICTURE: string;
  /** when it was favourited — `YYYY-MM-DD HH:MM:SS` */
  DATE_ADD?: string;
  NB_ALBUM?: number;
  NB_FAN?: number;
  ARTIST_IS_DUMMY?: boolean;
  __TYPE__?: string;
}

/** A favourited album, as the library returns it. */
export interface FavoriteAlbum {
  ALB_ID: string;
  ALB_TITLE: string;
  ALB_PICTURE: string;
  ART_ID?: string;
  ART_NAME?: string;
  DATE_ADD?: string;
  NUMBER_TRACK?: number;
  PHYSICAL_RELEASE_DATE?: string;
  __TYPE__?: string;
}

/** Resolve the caller's own user id when one wasn't supplied. */
const ownUserId = async (userId?: string | number): Promise<string> =>
  userId !== undefined ? String(userId) : String((await getUser()).USER_ID);

/**
 * The account's own playlists (`playlist.getList`) — **including private ones**,
 * which the public `/user/{id}/playlists` endpoint will not show you.
 *
 * @param userId defaults to the logged-in account
 */
export const getMyPlaylists = async (
  userId?: string | number,
  nb = 50,
  start = 0,
): Promise<GwList<playlistInfoMinimal>> =>
  request({user_id: await ownUserId(userId), nb, start, tab: 'all'}, 'playlist.getList');

/**
 * Loved tracks (`song.getFavorites`). Gateway track objects, so each carries a
 * `TRACK_TOKEN` and can go straight to `resolveDownloadUrls`.
 */
export const getMyFavoriteTracks = async (userId?: string | number, nb = 50, start = 0): Promise<GwList<trackType>> =>
  request({user_id: await ownUserId(userId), nb, start}, 'song.getFavorites');

/**
 * Just the ids of every loved track (`song.getFavoriteIds`) — one small request
 * for the whole set, for diffing a local library against the account.
 */
export const getMyFavoriteTrackIds = (): Promise<GwList<{SNG_ID: string}>> => request({}, 'song.getFavoriteIds');

/** Favourited albums (`album.getFavorites`). */
export const getMyFavoriteAlbums = async (
  userId?: string | number,
  nb = 50,
  start = 0,
): Promise<GwList<FavoriteAlbum>> => request({user_id: await ownUserId(userId), nb, start}, 'album.getFavorites');

/** Favourited artists (`artist.getFavorites`). */
export const getMyFavoriteArtists = async (
  userId?: string | number,
  nb = 50,
  start = 0,
): Promise<GwList<FavoriteArtist>> => request({user_id: await ownUserId(userId), nb, start}, 'artist.getFavorites');

/** Playlists the account follows (`playlist.getFavorites`). */
export const getMyFavoritePlaylists = async (
  userId?: string | number,
  nb = 50,
  start = 0,
): Promise<GwList<playlistInfoMinimal>> =>
  request({user_id: await ownUserId(userId), nb, start}, 'playlist.getFavorites');

/** Favourited radios (`radio.getFavorites`). */
export const getMyFavoriteRadios = async (
  userId?: string | number,
  nb = 50,
  start = 0,
): Promise<GwList<Record<string, any>>> => request({user_id: await ownUserId(userId), nb, start}, 'radio.getFavorites');

/** Favourited podcast shows (`show.getFavorites`). */
export const getMyFavoriteShows = async (
  userId?: string | number,
  nb = 50,
  start = 0,
): Promise<GwList<Record<string, any>>> => request({user_id: await ownUserId(userId), nb, start}, 'show.getFavorites');

/**
 * A "more like this" mix seeded from one track (`song.getSearchTrackMix`).
 *
 * Returns full gateway tracks **with `TRACK_TOKEN`s**, so unlike the public
 * radio endpoints the results are immediately downloadable — no `getTrackInfo`
 * round trip per hit.
 *
 * @param sngId the seed track's `SNG_ID`
 */
export const getTrackMix = (sngId: string, nb = 40, start = 0): Promise<GwList<trackType>> =>
  request({sng_id: sngId, start, nb}, 'song.getSearchTrackMix');
