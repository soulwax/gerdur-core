import test from 'ava';
import * as api from '../src';
import {Session} from '../src/lib/session';

/**
 * Offline tests for the shared gateway cache. No network: each Session's
 * `request` is stubbed so we can count wire calls and assert what is — and, more
 * importantly, what is *not* — shared between accounts.
 */

const ARL = (c: string) => c.repeat(192);

/** A Session whose gateway calls are stubbed; `calls` counts them. */
const stubSession = (arl: string, results: () => any) => {
  const session = new Session(arl);
  const state = {calls: 0};
  (session as any).request = async () => {
    state.calls++;
    return {data: {results: results()}};
  };
  return {session, state};
};

test.beforeEach(() => {
  api.clearSharedCaches();
});

test.serial('account-independent metadata is fetched once for many sessions', async (t) => {
  const album = () => ({ALB_ID: '302127', ALB_TITLE: 'Discovery'});
  const tenants = Array.from({length: 25}, (_, i) => stubSession(ARL(String(i % 10)), album));

  for (const {session} of tenants) {
    await session.getAlbumInfo('302127');
  }

  const wireCalls = tenants.reduce((n, tenant) => n + tenant.state.calls, 0);
  t.is(wireCalls, 1, '25 sessions reading the same album should hit the gateway once');

  const stats = api.cacheStats();
  t.is(stats.shared.size, 1);
  t.is(stats.shared.hits, 24);
});

test.serial('a concurrent burst coalesces into a single request', async (t) => {
  const lyrics = () => ({LYRICS_ID: '1', LYRICS_TEXT: 'hello'});
  const tenants = Array.from({length: 25}, (_, i) => stubSession(ARL(String(i % 10)), lyrics));

  await Promise.all(tenants.map(({session}) => session.getLyrics('3135556')));

  const wireCalls = tenants.reduce((n, tenant) => n + tenant.state.calls, 0);
  t.is(wireCalls, 1, 'in-flight sharing should collapse the burst to one request');
  t.is(api.cacheStats().shared.inFlight, 0, 'the in-flight entry must be released');
});

test.serial('token-bearing payloads are NEVER shared between accounts', async (t) => {
  const one = stubSession(ARL('a'), () => ({SNG_ID: '1', TRACK_TOKEN: 'token-for-a'}));
  const two = stubSession(ARL('b'), () => ({SNG_ID: '1', TRACK_TOKEN: 'token-for-b'}));

  const first = await one.session.getTrackInfo('1');
  const second = await two.session.getTrackInfo('1');

  t.is(one.state.calls, 1);
  t.is(two.state.calls, 1, 'song.getData must not be served from another account');
  t.is(first.TRACK_TOKEN, 'token-for-a');
  t.is(second.TRACK_TOKEN, 'token-for-b');
  t.is(api.cacheStats().shared.size, 0, 'nothing token-bearing may land in the shared cache');
});

test.serial('playlist tracks and album tracks stay per-session', async (t) => {
  const tracks = () => ({data: [{SNG_ID: '1', TRACK_TOKEN: 'per-account'}], total: 1});
  const one = stubSession(ARL('a'), tracks);
  const two = stubSession(ARL('b'), tracks);

  await one.session.getPlaylistTracks('123');
  await two.session.getPlaylistTracks('123');
  await one.session.getAlbumTracks('456');
  await two.session.getAlbumTracks('456');

  t.is(one.state.calls, 2);
  t.is(two.state.calls, 2, 'song list endpoints carry TRACK_TOKENs — no cross-account reuse');
  t.is(api.cacheStats().shared.size, 0);
});

test.serial('shared entries are partitioned by country', async (t) => {
  const de = stubSession(ARL('c'), () => ({ALB_ID: '1', AVAILABLE: 'de'}));
  const us = stubSession(ARL('d'), () => ({ALB_ID: '1', AVAILABLE: 'us'}));
  (de.session as any).userData = {country: 'DE', licenseToken: '', canStreamLossless: false, canStreamHq: false};
  (us.session as any).userData = {country: 'US', licenseToken: '', canStreamLossless: false, canStreamHq: false};

  const deAlbum: any = await de.session.getAlbumInfo('1');
  const usAlbum: any = await us.session.getAlbumInfo('1');

  t.is(deAlbum.AVAILABLE, 'de');
  t.is(usAlbum.AVAILABLE, 'us', 'a DE view must never be served to a US session');
  t.is(api.cacheStats().shared.size, 2, 'one entry per country');
});

test.serial('configureCache resizes and clearSharedCaches empties', async (t) => {
  const {session} = stubSession(ARL('e'), () => ({ALB_ID: '1'}));
  await session.getAlbumInfo('1');
  t.is(api.cacheStats().shared.size, 1);

  api.clearSharedCaches();
  t.is(api.cacheStats().shared.size, 0);

  api.configureCache({shared: {maxSize: 5, ttl: 1000}});
  t.is(api.cacheStats().shared.maxSize, 5);

  // restore the default so later tests aren't run against a tiny cache
  api.configureCache({shared: {maxSize: 2000, ttl: 60 * 60_000}});
  t.is(api.cacheStats().shared.maxSize, 2000);
});
