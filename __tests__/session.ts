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
