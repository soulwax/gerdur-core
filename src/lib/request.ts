import delay from 'delay';
import type {HttpQuery, HttpResponse} from './http';
import {HttpClient} from './http';

let user_arl =
  'c973964816688562722418b5200c1515dffaad15a42643ebf87cc72824a54612ec51c2ad42d566743f9e424c774e98ccae7737770acff59251328e6cd598c7bcac38ca269adf78bfb88ec5bbad6cd800db3c0b88b2af645bb22b99e71de26416';

type DeezerResponseError = Record<string, any>;

type DeezerRequestConfig = {
  headers?: Record<string, string>;
  params?: HttpQuery;
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

let token_retry = 0;

const requestWithRetry = async <T>(
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  config: DeezerRequestConfig = {},
): Promise<HttpResponse<T>> => {
  const response = method === 'POST' ? await instance.post<T>(url, body, config) : await instance.get<T>(url, config);
  const error = (response.data as any)?.error as DeezerResponseError | undefined;

  if (!error || Object.keys(error).length === 0) {
    token_retry = 0;
    return response;
  }

  if (error.NEED_API_AUTH_REQUIRED) {
    await initDeezerApi(user_arl);
    return await requestWithRetry<T>(method, url, body, config);
  }

  if (error.code === 4) {
    await delay.range(1000, 1500);
    return await requestWithRetry<T>(method, url, body, config);
  }

  if (error.GATEWAY_ERROR || (error.VALID_TOKEN_REQUIRED && token_retry < 15)) {
    token_retry += 1;
    await getApiToken();
    return await requestWithRetry<T>(method, url, body, config);
  }

  token_retry = 0;
  return response;
};

export default {
  defaults: instance.defaults,
  get: async <T>(url: string, config: DeezerRequestConfig = {}): Promise<HttpResponse<T>> =>
    await requestWithRetry<T>('GET', url, undefined, config),
  post: async <T>(url: string, body?: unknown, config: DeezerRequestConfig = {}): Promise<HttpResponse<T>> =>
    await requestWithRetry<T>('POST', url, body, config),
};
