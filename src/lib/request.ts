import type {HttpQuery, HttpResponse} from './http';
import {defaultSession} from './session';

export {initDeezerApi, createSession, defaultSession, setDefaultSession, Session, RETRY_POLICY} from './session';
export type {SessionUserData} from './session';

type DeezerRequestConfig = {
  headers?: Record<string, string>;
  params?: HttpQuery;
};

/**
 * A thin proxy over the **default** {@link Session} — kept so the api / get-url
 * layers can keep calling `client.get` / `client.post` unchanged. Each call runs
 * through the session's bounded-retry loop.
 */
export default {
  get defaults() {
    return defaultSession().http.defaults;
  },
  get: <T>(url: string, config: DeezerRequestConfig = {}): Promise<HttpResponse<T>> =>
    defaultSession().request<T>('GET', url, undefined, config),
  post: <T>(url: string, body?: unknown, config: DeezerRequestConfig = {}): Promise<HttpResponse<T>> =>
    defaultSession().request<T>('POST', url, body, config),
};
