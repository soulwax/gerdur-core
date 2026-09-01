/**
 * **Mutating** operations on the logged-in account's library.
 *
 * Everything else in this package reads. These change the account, so they are
 * kept in their own module and none of them are wired into any download path —
 * you have to call them deliberately.
 *
 * The method names here were established by probing the gateway with incomplete
 * parameters, which makes an existing method answer `MISSING_PARAMETER_*` while
 * an absent one answers `GATEWAY_ERROR` — so the surface was mapped without
 * creating or changing anything.
 *
 * **Deezer's gateway exposes no way to delete a playlist.** `playlist.delete`,
 * `.remove`, `.destroy` and nine other spellings all answer `GATEWAY_ERROR`.
 * {@link createPlaylist} is therefore a one-way door: whatever it makes, you
 * remove from a Deezer client, not from here. Everything else on this page has a
 * confirmed inverse and is safe to undo.
 */
import {request} from './request';

/** What the gateway returns for a mutation — usually `true`, or the new id. */
export type WriteResult = boolean | string | number | Record<string, any>;

// ─── Loved tracks ────────────────────────────────────────────────────────────

/**
 * Love one or more tracks (`song.addFavorites`). Reversible with
 * {@link removeFavoriteTracks}.
 *
 * @param sngIds `SNG_ID`s
 */
export const addFavoriteTracks = (sngIds: (string | number)[]): Promise<WriteResult> =>
  request({ids: sngIds.map(String)}, 'song.addFavorites');

/** Un-love one or more tracks (`song.removeFavorites`). */
export const removeFavoriteTracks = (sngIds: (string | number)[]): Promise<WriteResult> =>
  request({ids: sngIds.map(String)}, 'song.removeFavorites');

// ─── Albums / artists ────────────────────────────────────────────────────────

/** Add an album to favourites (`album.addFavorite`). */
export const addFavoriteAlbum = (albId: string | number): Promise<WriteResult> =>
  request({alb_id: String(albId)}, 'album.addFavorite');

/** Remove an album from favourites (`album.deleteFavorite`). */
export const removeFavoriteAlbum = (albId: string | number): Promise<WriteResult> =>
  request({alb_id: String(albId)}, 'album.deleteFavorite');

/** Follow an artist (`artist.addFavorite`). */
export const addFavoriteArtist = (artId: string | number): Promise<WriteResult> =>
  request({art_id: String(artId)}, 'artist.addFavorite');

/** Unfollow an artist (`artist.deleteFavorite`). */
export const removeFavoriteArtist = (artId: string | number): Promise<WriteResult> =>
  request({art_id: String(artId)}, 'artist.deleteFavorite');

// ─── Playlists & shows ───────────────────────────────────────────────────────

/**
 * Follow someone else's playlist (`playlist.addFavorite`). Note the gateway
 * wants `parent_playlist_id` here but plain `playlist_id` to unfollow.
 */
export const followPlaylist = (playlistId: string | number): Promise<WriteResult> =>
  request({parent_playlist_id: String(playlistId)}, 'playlist.addFavorite');

/** Unfollow a playlist (`playlist.deleteFavorite`). */
export const unfollowPlaylist = (playlistId: string | number): Promise<WriteResult> =>
  request({playlist_id: String(playlistId)}, 'playlist.deleteFavorite');

/**
 * Follow a podcast show (`show.addFavorite`).
 *
 * No `show.deleteFavorite` answered the probe, so treat this as one-way until
 * the inverse is found.
 */
export const addFavoriteShow = (showId: string | number): Promise<WriteResult> =>
  request({show_id: String(showId)}, 'show.addFavorite');

// ─── Playlist contents ───────────────────────────────────────────────────────

/**
 * Create a playlist (`playlist.create`). Resolves to the new `PLAYLIST_ID`.
 *
 * **One-way.** The gateway has no delete counterpart (see the module note), so
 * anything created here has to be removed from a Deezer client. For the same
 * reason this is the one function on this page that has not been exercised
 * against a live account.
 *
 * @param title       playlist title
 * @param options     `description`, `status` (0 public / 1 private / 2 collaborative),
 *                    and `songs` to seed it with `SNG_ID`s
 */
export const createPlaylist = (
  title: string,
  options: {description?: string; status?: 0 | 1 | 2; songs?: (string | number)[]} = {},
): Promise<WriteResult> =>
  request(
    {
      title,
      description: options.description ?? '',
      status: options.status ?? 1,
      songs: (options.songs ?? []).map((id) => [String(id), 0]),
    },
    'playlist.create',
  );

/**
 * Append tracks to a playlist (`playlist.addSongs`). Reversible with
 * {@link removeTracksFromPlaylist}.
 *
 * The gateway takes `songs` as `[[sngId, offset], …]`; this wraps that for you.
 */
export const addTracksToPlaylist = (playlistId: string | number, sngIds: (string | number)[]): Promise<WriteResult> =>
  request({playlist_id: String(playlistId), songs: sngIds.map((id) => [String(id), 0])}, 'playlist.addSongs');

/** Remove tracks from a playlist (`playlist.deleteSongs`). */
export const removeTracksFromPlaylist = (
  playlistId: string | number,
  sngIds: (string | number)[],
): Promise<WriteResult> =>
  request({playlist_id: String(playlistId), songs: sngIds.map((id) => [String(id), 0])}, 'playlist.deleteSongs');
