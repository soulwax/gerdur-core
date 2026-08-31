import delay from 'delay';
import type {HttpQuery, HttpResponse} from './http';
import {HttpClient} from './http';
import {DeezerError} from './errors';
import type {DeezerErrorPayload} from './errors';

let user_arl =
  'c973964816688562722418b5200c1515dffaad15a42643ebf87cc72824a54612ec51c2ad42d566743f9e424c774e98ccae7737770acff59251328e6cd598c7bcac38ca269adf78bfb88ec5bbad6cd800db3c0b88b2af645bb22b99e71de26416';

type DeezerRequestConfig = {
  headers?: Record<string, string>;
  params?: HttpQuery;
};

/**
 * Bounded-retry policy for the gateway. Every retry class has its own attempt
 * cap **and** there is a wall-clock deadline, so a persistently failing endpoint
 * can no longer spin forever (the old code had no cap on `code === 4`,
 * `NEED_API_AUTH_REQUIRED` or `GATEWAY_ERROR`).
 */
export const RETRY_POLICY = {
  /** total attempts for the transient `code === 4` class */
  code4Attempts: 6,
  /** re-inits allowed for `NEED_API_AUTH_REQUIRED` */
  authReinits: 3,
  /** token refreshes allowed for `GATEWAY_ERROR` / `VALID_TOKEN_REQUIRED` */
  tokenRefreshes: 15,
  /** base backoff (ms) — grows exponentially, full-jittered */
  baseMs: 800,
  /** cap on a single backoff wait */
  maxDelayMs: 8000,
  /** overall wall-clock budget from the first attempt */
  deadlineMs: 30_000,
};

/** Exponential backoff (ms) with full jitter on the top half of the window. */
const backoffDelay = (attempt: number): number => {
  const windowMs = Math.min(RETRY_POLICY.baseMs * 2 ** attempt, RETRY_POLICY.maxDelayMs);
  return windowMs / 2 + Math.random() * (windowMs / 2);
};

const instance = new HttpClient({
  baseURL: 'https://api.deezer.com/1.0',
  timeout: 15000,
  headers: {
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': 'Deezer/8.32.0.2 (iOS; 14.4; Mobile; en; iPhone10_5)',
  },
  params: {
    version: '8.32.0',
    api_key: 'ZAIVAHCEISOHWAICUQUEXAEPICENGUAFAEZAIPHAELEEVAHPHUCUFONGUAPASUAY',
    output: 3,
    input: 3,
    buildId: 'ios12_universal',
    screenHeight: '480',
    screenWidth: '320',
    lang: 'en',
  },
});

const getApiToken = async (): Promise<string> => {
  const {data} = await instance.get<any>('https://www.deezer.com/ajax/gw-light.php', {
    params: {
      method: 'deezer.getUserData',
      api_version: '1.0',
      api_token: 'null',
    },
  });
  instance.defaults.params.sid = data.results.SESSION_ID;
  instance.defaults.params.api_token = data.results.checkForm;
  return data.results.checkForm;
};

export const initDeezerApi = async (arl: string): Promise<string> => {
  if (arl.length !== 192) {
    throw new Error(`Invalid arl. Length should be 192 characters. You have provided ${arl.length} characters.`);
  }
  user_arl = arl;
  const {data} = await instance.get<any>('https://www.deezer.com/ajax/gw-light.php', {
    params: {method: 'deezer.ping', api_version: '1.0', api_token: ''},
    headers: {cookie: 'arl=' + arl},
  });
  instance.defaults.params.sid = data.results.SESSION;
  return data.results.SESSION;
};

const requestWithRetry = async <T>(
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  config: DeezerRequestConfig = {},
): Promise<HttpResponse<T>> => {
  const startedAt = Date.now();
  let authReinits = 0;
  let tokenRefreshes = 0;
  let code4Attempts = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = method === 'POST' ? await instance.post<T>(url, body, config) : await instance.get<T>(url, config);
    const error = (response.data as {error?: DeezerErrorPayload})?.error;

    if (!error || Object.keys(error).length === 0) {
      return response;
    }

    const overDeadline = Date.now() - startedAt > RETRY_POLICY.deadlineMs;

    if (error.NEED_API_AUTH_REQUIRED && authReinits < RETRY_POLICY.authReinits && !overDeadline) {
      authReinits += 1;
      await initDeezerApi(user_arl);
      continue;
    }

    if (
      (error.GATEWAY_ERROR || error.VALID_TOKEN_REQUIRED) &&
      tokenRefreshes < RETRY_POLICY.tokenRefreshes &&
      !overDeadline
    ) {
      tokenRefreshes += 1;
      await getApiToken();
      await delay(backoffDelay(tokenRefreshes - 1));
      continue;
    }

    if (error.code === 4 && code4Attempts < RETRY_POLICY.code4Attempts && !overDeadline) {
      await delay(backoffDelay(code4Attempts));
      code4Attempts += 1;
      continue;
    }

    // Unhandled error, or a retry class ran out of attempts / hit the deadline.
    throw new DeezerError(error);
  }
};

export default {
  defaults: instance.defaults,
  get: async <T>(url: string, config: DeezerRequestConfig = {}): Promise<HttpResponse<T>> =>
    await requestWithRetry<T>('GET', url, undefined, config),
  post: async <T>(url: string, body?: unknown, config: DeezerRequestConfig = {}): Promise<HttpResponse<T>> =>
    await requestWithRetry<T>('POST', url, body, config),
};
