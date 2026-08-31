import delay from 'delay';
import {DeezerError} from './errors';
import type {DeezerErrorPayload} from './errors';
import {HttpClient} from './http';
import type {HttpQuery, HttpResponse} from './http';

/**
 * The bundled default `arl`. It is shared, rate-limited and expiring — good for
 * unauthenticated endpoints, useless for downloads. `initDeezerApi` /
 * `createSession` replace it.
 */
export const DEFAULT_ARL =
  'c973964816688562722418b5200c1515dffaad15a42643ebf87cc72824a54612ec51c2ad42d566743f9e424c774e98ccae7737770acff59251328e6cd598c7bcac38ca269adf78bfb88ec5bbad6cd800db3c0b88b2af645bb22b99e71de26416';

/**
 * Bounded-retry policy for the gateway. Every retry class has its own attempt
 * cap **and** there is a wall-clock deadline, so a persistently failing endpoint
 * can no longer spin forever.
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

/** How long a loaded `deezer.getUserData` payload is trusted before a refresh. */
const USER_DATA_TTL_MS = 25 * 60 * 1000;

type SessionRequestConfig = {
  headers?: Record<string, string>;
  params?: HttpQuery;
};

/** The account-scoped bits of `deezer.getUserData` a download needs. */
export interface SessionUserData {
  /** the `license_token` the media API's `get_url` requires */
  licenseToken: string;
  /** ISO country the account resolves to (drives geo-blocking) */
  country: string;
  /** account may stream FLAC */
  canStreamLossless: boolean;
  /** account may stream 320 kbps */
  canStreamHq: boolean;
  offerId?: number;
}

/**
 * One Deezer session — owns the `arl`, the HTTP client (and its `sid` /
 * `api_token`), and the account's `license_token` / `country` / streaming
 * rights, plus the bounded-retry request loop and token refresh.
 *
 * The state used to be spread across module-level variables in `request.ts` and
 * `get-url.ts`; a `Session` bundles it so multiple accounts can coexist. The
 * free functions (`getTrackInfo`, `request`, …) run against a process-wide
 * default session; `createSession(arl)` gives you an isolated one.
 */
export class Session {
  /** the arl cookie in use */
  arl: string;
  /** the underlying HTTP client — its `defaults.params` carry `sid` / `api_token` */
  readonly http: HttpClient;

  private userData: SessionUserData | null = null;
  private userDataAt = 0;

  constructor(arl?: string) {
    this.arl = arl ?? DEFAULT_ARL;
    this.http = new HttpClient({
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
  }

  /** current gateway session id */
  get sid(): string | undefined {
    return this.http.defaults.params.sid as string | undefined;
  }

  /** current CSRF-ish api token */
  get apiToken(): string | undefined {
    return this.http.defaults.params.api_token as string | undefined;
  }

  /** ISO country the account resolves to, once `loadUserData` has run */
  get country(): string | undefined {
    return this.userData?.country;
  }

  /** the media-API `license_token`, once `loadUserData` has run */
  get licenseToken(): string | undefined {
    return this.userData?.licenseToken;
  }

  get canStreamLossless(): boolean {
    return this.userData?.canStreamLossless ?? false;
  }

  get canStreamHq(): boolean {
    return this.userData?.canStreamHq ?? false;
  }

  /**
   * Ping `gw-light.php` for a fresh `SESSION` id. Pass an `arl` to (re)authenticate
   * this session as that account — it must be exactly 192 characters.
   * Returns the new `SESSION`.
   */
  async init(arl?: string): Promise<string> {
    if (arl !== undefined) {
      if (arl.length !== 192) {
        throw new Error(`Invalid arl. Length should be 192 characters. You have provided ${arl.length} characters.`);
      }
      this.arl = arl;
      this.userData = null;
    }
    const {data} = await this.http.get<any>('https://www.deezer.com/ajax/gw-light.php', {
      params: {method: 'deezer.ping', api_version: '1.0', api_token: ''},
      headers: {cookie: 'arl=' + this.arl},
    });
    this.http.defaults.params.sid = data.results.SESSION;
    return data.results.SESSION;
  }

  /** Refresh `sid` + `api_token` from `deezer.getUserData`. Returns the api token. */
  async refreshApiToken(): Promise<string> {
    const {data} = await this.http.get<any>('https://www.deezer.com/ajax/gw-light.php', {
      params: {method: 'deezer.getUserData', api_version: '1.0', api_token: 'null'},
    });
    this.http.defaults.params.sid = data.results.SESSION_ID;
    this.http.defaults.params.api_token = data.results.checkForm;
    return data.results.checkForm;
  }

  /**
   * The account's `license_token` / `country` / streaming rights, from
   * `deezer.getUserData`. Cached for {@link USER_DATA_TTL_MS}; pass `force` (or
   * see a media-API 403) to refresh. Also refreshes `sid` / `api_token`.
   */
  async loadUserData(force = false): Promise<SessionUserData> {
    if (this.userData && !force && Date.now() - this.userDataAt < USER_DATA_TTL_MS) {
      return this.userData;
    }
    const {data} = await this.http.get<any>('https://www.deezer.com/ajax/gw-light.php', {
      params: {method: 'deezer.getUserData', api_version: '1.0', api_token: 'null'},
    });
    const options = data.results?.USER?.OPTIONS ?? {};
    this.userData = {
      licenseToken: options.license_token,
      country: data.results?.COUNTRY,
      canStreamLossless: Boolean(options.web_lossless || options.mobile_loseless),
      canStreamHq: Boolean(options.web_hq || options.mobile_hq),
      offerId: data.results?.OFFER_ID,
    };
    this.userDataAt = Date.now();
    if (data.results?.checkForm) {
      this.http.defaults.params.api_token = data.results.checkForm;
    }
    if (data.results?.SESSION_ID) {
      this.http.defaults.params.sid = data.results.SESSION_ID;
    }
    return this.userData;
  }

  /** Drop the cached user data so the next `loadUserData` re-fetches. */
  invalidateUserData(): void {
    this.userData = null;
  }

  /**
   * The bounded-retry gateway request loop. Handles `NEED_API_AUTH_REQUIRED`
   * (re-init), `GATEWAY_ERROR` / `VALID_TOKEN_REQUIRED` (token refresh) and
   * `code === 4` (transient), each with its own attempt cap, full-jittered
   * backoff, and a wall-clock deadline. Throws `DeezerError` on exhaustion.
   */
  async request<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    config: SessionRequestConfig = {},
  ): Promise<HttpResponse<T>> {
    const startedAt = Date.now();
    let authReinits = 0;
    let tokenRefreshes = 0;
    let code4Attempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response =
        method === 'POST' ? await this.http.post<T>(url, body, config) : await this.http.get<T>(url, config);
      const error = (response.data as {error?: DeezerErrorPayload})?.error;

      if (!error || Object.keys(error).length === 0) {
        return response;
      }

      const overDeadline = Date.now() - startedAt > RETRY_POLICY.deadlineMs;

      if (error.NEED_API_AUTH_REQUIRED && authReinits < RETRY_POLICY.authReinits && !overDeadline) {
        authReinits += 1;
        await this.init();
        continue;
      }

      if (
        (error.GATEWAY_ERROR || error.VALID_TOKEN_REQUIRED) &&
        tokenRefreshes < RETRY_POLICY.tokenRefreshes &&
        !overDeadline
      ) {
        tokenRefreshes += 1;
        await this.refreshApiToken();
        await delay(backoffDelay(tokenRefreshes - 1));
        continue;
      }

      if (error.code === 4 && code4Attempts < RETRY_POLICY.code4Attempts && !overDeadline) {
        await delay(backoffDelay(code4Attempts));
        code4Attempts += 1;
        continue;
      }

      throw new DeezerError(error);
    }
  }
}

let _default = new Session();

/** The process-wide default session every free function runs against. */
export const defaultSession = (): Session => _default;

/**
 * (Re)authenticate the **default** session. Kept for backwards compatibility —
 * `createSession` is the way to hold an isolated session. `arl` must be exactly
 * 192 characters. Returns the gateway `SESSION` id.
 */
export const initDeezerApi = (arl: string): Promise<string> => _default.init(arl);

/**
 * Create an **isolated** Deezer session — its own `arl`, `sid`, tokens and
 * `license_token`, so multiple accounts can be used concurrently. Without an
 * `arl` it runs on the bundled (shared, rate-limited) default.
 */
export const createSession = async (arl?: string): Promise<Session> => {
  const session = new Session(arl);
  await session.init();
  return session;
};

/** Replace the default session (used by tests). */
export const setDefaultSession = (session: Session): void => {
  _default = session;
};
