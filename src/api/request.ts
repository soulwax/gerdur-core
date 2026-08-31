import {DeezerError} from '../lib/errors';
import client from '../lib/request';
import {defaultSession} from '../lib/session';
import lru from './cache';

/**
 * The gateway request helpers are now thin wrappers over the **default**
 * {@link Session} — its per-session cache + single-flight coalescing does the
 * de-duplication that used to live here. `createSession(arl)` gives you an
 * isolated one whose `session.gw(...)` / `session.getTrackInfo(...)` don't share
 * this cache.
 */

/** POST `gateway.php` (main gw channel). */
export const request = (body: object, method: string) => defaultSession().gw(body as Record<string, unknown>, method);

/** POST `gw-light.php` (search / suggest / lighter methods). */
export const requestLight = (body: object, method: string) =>
  defaultSession().gwLight(body as Record<string, unknown>, method);

/** GET `gateway.php` (app_page_get, user_getInfo, …). */
export const requestGet = (method: string, params: Record<string, any> = {}, key = 'get_request') =>
  defaultSession().gwGet(method, params, key);

/**
 * GET the public REST API (`api.deezer.com`). Account-independent, so it keeps
 * its own process-wide cache rather than a per-session one.
 */
const inFlightPublic = new Map<string, Promise<any>>();
export const requestPublicApi = (slug: string): Promise<any> => {
  const cached = lru.get(slug);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inFlightPublic.get(slug);
  if (pending) {
    return pending;
  }
  const promise = (async () => {
    try {
      const {data} = await client.get<any>('https://api.deezer.com' + slug);
      if (data.error) {
        throw new DeezerError(data.error);
      }
      lru.set(slug, data);
      return data;
    } finally {
      inFlightPublic.delete(slug);
    }
  })();
  inFlightPublic.set(slug, promise);
  return promise;
};
