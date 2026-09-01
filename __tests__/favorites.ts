import test from 'ava';
import * as api from '../src';
import {ensureDeezerUserAuth, skipIfRateLimited, skipWithReason} from './helpers';

/**
 * These tests **change the live account**, so they are opt-in:
 *
 * ```bash
 * GERDUR_ALLOW_WRITE_TESTS=1 HIFI_ARL=<arl> npx ava __tests__/favorites.ts
 * ```
 *
 * Each one is a round trip — snapshot, mutate, assert it registered, revert,
 * assert the count is exactly what it was. Entities are chosen so that a
 * successful run leaves the library untouched. If a revert ever fails the
 * assertion says so loudly rather than passing quietly.
 *
 * `createPlaylist` is deliberately not exercised: Deezer's gateway has no delete
 * counterpart, so there is no way to clean up after it.
 */

const writesAllowed = process.env.GERDUR_ALLOW_WRITE_TESTS === '1';

const guard = async (t: any): Promise<boolean> => {
  if (!writesAllowed) {
    skipWithReason(t, 'Set GERDUR_ALLOW_WRITE_TESTS=1 to run tests that modify the Deezer account.');
    return false;
  }
  return ensureDeezerUserAuth(t);
};

const settle = () => new Promise((r) => setTimeout(r, 700));

test.serial('loved tracks — add then remove restores the count', async (t) => {
  if (!(await guard(t))) return;
  try {
    const before = (await api.getMyFavoriteTrackIds()).total;

    await api.addFavoriteTracks(['3135556']);
    await settle();
    t.true((await api.getMyFavoriteTrackIds()).total > before, 'the track was loved');

    await api.removeFavoriteTracks(['3135556']);
    await settle();
    t.is((await api.getMyFavoriteTrackIds()).total, before, 'the library is back to where it started');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test.serial('favourite albums — add then remove restores the count', async (t) => {
  if (!(await guard(t))) return;
  try {
    const count = async () => (await api.getMyFavoriteAlbums(undefined, 1)).total;
    const before = await count();

    await api.addFavoriteAlbum('302127');
    await settle();
    t.true((await count()) > before, 'the album was favourited');

    await api.removeFavoriteAlbum('302127');
    await settle();
    t.is(await count(), before, 'the library is back to where it started');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test.serial('favourite artists — add then remove restores the count', async (t) => {
  if (!(await guard(t))) return;
  try {
    const count = async () => (await api.getMyFavoriteArtists(undefined, 1)).total;
    const existing = new Set((await api.getMyFavoriteArtists(undefined, 100)).data.map((a) => String(a.ART_ID)));
    // an artist the account does not already follow, so the trip is a true no-op
    const artId = ['27', '13', '1424821', '230'].find((id) => !existing.has(id));
    if (!artId) {
      return skipWithReason(t, 'every candidate artist is already followed');
    }
    const before = await count();

    await api.addFavoriteArtist(artId);
    await settle();
    t.true((await count()) > before, `artist ${artId} was followed`);

    await api.removeFavoriteArtist(artId);
    await settle();
    t.is(await count(), before, 'the library is back to where it started');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});
