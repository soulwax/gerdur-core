import test from 'ava';
import * as api from '../src';
import {ensureDeezerUserAuth, skipIfRateLimited} from './helpers';

/**
 * The authenticated library — what the account itself can see, as opposed to the
 * public-REST profile surface in `api.ts`. Assertions are on the envelope shape
 * rather than on contents, since the fixture account's library changes.
 */

const isGwList = (t: any, r: any, label: string) => {
  t.true(Array.isArray(r.data), `${label}.data is an array`);
  t.is(typeof r.total, 'number', `${label}.total is a number`);
  t.true(r.data.length <= r.total || r.total === 0, `${label} page fits its total`);
};

test('library — playlists and favourites return gateway listings', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }
  try {
    const [playlists, artists, albums, ids] = await Promise.all([
      api.getMyPlaylists(undefined, 5),
      api.getMyFavoriteArtists(undefined, 5),
      api.getMyFavoriteAlbums(undefined, 5),
      api.getMyFavoriteTrackIds(),
    ]);
    isGwList(t, playlists, 'getMyPlaylists');
    isGwList(t, artists, 'getMyFavoriteArtists');
    isGwList(t, albums, 'getMyFavoriteAlbums');
    isGwList(t, ids, 'getMyFavoriteTrackIds');

    for (const a of artists.data) {
      t.truthy(a.ART_ID, 'favourite artist has an id');
      t.truthy(a.ART_NAME, 'favourite artist has a name');
    }
    for (const p of playlists.data) {
      t.truthy(p.PLAYLIST_ID, 'playlist has an id');
    }
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('getTrackMix — seeded mix comes back downloadable', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }
  try {
    const mix = await api.getTrackMix('3135556', 5);
    isGwList(t, mix, 'getTrackMix');
    t.true(mix.data.length > 0, 'the mix is not empty');
    for (const track of mix.data) {
      t.truthy(track.SNG_ID);
      t.truthy(track.SNG_TITLE);
      // the point of this endpoint: tokens are already attached, so no
      // getTrackInfo round trip is needed before resolving a download URL
      t.truthy(track.TRACK_TOKEN, `${track.SNG_TITLE} carries a TRACK_TOKEN`);
    }
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});
