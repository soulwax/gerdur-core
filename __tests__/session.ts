import test from 'ava';
import * as api from '../src';
import {ensureDeezerUserAuth, skipIfRateLimited} from './helpers';

test('createSession — isolated, inspectable state', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }
  try {
    const session = await api.createSession(process.env.HIFI_ARL);
    t.true(session instanceof api.Session);
    t.is(session.arl.length, 192);
    t.truthy(session.sid);

    const ud = await session.loadUserData();
    t.truthy(ud.licenseToken);
    t.regex(ud.country, /^[A-Z]{2}$/);
    t.is(typeof ud.canStreamLossless, 'boolean');
    t.is(session.country, ud.country);
    t.is(session.licenseToken, ud.licenseToken);

    // a second createSession is a distinct object
    const other = await api.createSession(process.env.HIFI_ARL);
    t.not(session, other);
    t.not(session.http, other.http);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('defaultSession — what initDeezerApi and the free functions use', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }
  const sid = await api.initDeezerApi(process.env.HIFI_ARL as string);
  t.true(typeof sid === 'string' && sid.length > 0);

  const def = api.defaultSession();
  t.true(def instanceof api.Session);
  t.is(def.arl, process.env.HIFI_ARL);
  t.is(def.sid, sid);
});

test('initDeezerApi still rejects a wrong-length arl', async (t) => {
  await t.throwsAsync(() => api.initDeezerApi('too-short'), {message: /192 characters/});
});

test('Session query methods run against that account', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }
  try {
    const session = await api.createSession(process.env.HIFI_ARL);

    const track = await session.getTrackInfo('3135556');
    t.is(track.SNG_ID, '3135556');
    t.truthy(track.TRACK_TOKEN, 'the token is this session’s');

    const album = await session.getAlbumTracks('302127');
    t.is(album.count, 14);

    const artist = await session.getArtistInfo('27');
    t.is(artist.ART_NAME, 'Daft Punk');

    const search = await session.searchMusic('daft punk', ['TRACK', 'ARTIST'], 2);
    t.true(search.TRACK.count > 0 && search.ARTIST.count > 0);

    const user = await session.getUser();
    t.truthy(user.USER_ID);

    // second call is served from this session's cache (same object)
    t.is(await session.getTrackInfo('3135556'), track);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('each session has its own cache', async (t) => {
  const a = await api.createSession();
  const b = await api.createSession();
  t.not(a.cache, b.cache);
  a.cache.set('k', 1);
  t.is(b.cache.get('k'), undefined);
});
