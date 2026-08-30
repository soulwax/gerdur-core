import client from '../lib/request';
import lru from './cache';

/**
 * In-flight request coalescing (single-flight).
 *
 * The LRU only helps *after* a response lands. During a batch download the
 * pipeline fires many identical metadata calls at once — e.g. tagging 14 tracks
 * of one album triggers 14 concurrent `album/<id>` lookups — and every one of
 * them misses the still-empty cache and hits the network. Here a second caller
 * for a key already in flight awaits the same promise instead, so the wire sees
 * exactly one request. Entries are removed as soon as they settle; the LRU takes
 * over from there.
 */
const inFlight = new Map<string, Promise<any>>();

const coalesce = <T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> => {
  const cached = lru.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const pending = inFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      inFlight.delete(cacheKey);
    }
  })();
  inFlight.set(cacheKey, promise);
  return promise;
};

/**
 * Make POST requests to deezer api
 * @param {Object} body post body
 * @param {String} method request method
 */
export const request = async (body: object, method: string) => {
  const cacheKey = method + ':' + Object.entries(body).join(':');
  return coalesce(cacheKey, async () => {
    const {
      data: {error, results},
    } = await client.post<any>('/gateway.php', body, {params: {method}});

    if (Object.keys(results).length > 0) {
      lru.set(cacheKey, results);
      return results;
    }

    throw new Error(Object.entries(error).join(', '));
  });
};

/**
 * Make POST requests to deezer api
 * @param {Object} body post body
 * @param {String} method request method
 */
export const requestLight = async (body: object, method: string) => {
  const cacheKey = method + ':' + Object.entries(body).join(':');
  return coalesce(cacheKey, async () => {
    const {
      data: {error, results},
    } = await client.post<any>('https://www.deezer.com/ajax/gw-light.php', body, {
      params: {method, api_version: '1.0'},
    });

    if (Object.keys(results).length > 0) {
      lru.set(cacheKey, results);
      return results;
    }

    throw new Error(Object.entries(error).join(', '));
  });
};

/**
 * Make GET requests to deezer public api
 * @param {String} method request method
 * @param {Object} params request parameters
 */
export const requestGet = async (method: string, params: Record<string, any> = {}, key = 'get_request') => {
  const cacheKey = method + key;
  return coalesce(cacheKey, async () => {
    const {
      data: {error, results},
    } = await client.get<any>('/gateway.php', {params: {method, ...params}});

    if (Object.keys(results).length > 0) {
      lru.set(cacheKey, results);
      return results;
    }

    throw new Error(Object.entries(error).join(', '));
  });
};

/**
 * Make GET requests to deezer public api
 * @param {String} slug endpoint
 */
export const requestPublicApi = async (slug: string) => {
  return coalesce(slug, async () => {
    const {data} = await client.get<any>('https://api.deezer.com' + slug);

    if (data.error) {
      const errorMessage = Object.entries(data.error).join(', ');
      throw new Error(errorMessage);
    }

    lru.set(slug, data);
    return data;
  });
};
