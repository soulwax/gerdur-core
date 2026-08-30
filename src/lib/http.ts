import {Agent as HttpAgent, IncomingHttpHeaders, request as httpRequest} from 'http';
import {Agent as HttpsAgent, request as httpsRequest} from 'https';
import {brotliDecompressSync, gunzipSync, inflateSync} from 'zlib';

type HttpMethod = 'GET' | 'POST' | 'HEAD';
type ResponseType = 'buffer' | 'json' | 'text';
type QueryValue = string | number | boolean | null | undefined;
type QueryInput = QueryValue | QueryValue[];

export type HttpHeaders = Record<string, string>;
export type HttpQuery = Record<string, QueryInput>;

export interface HttpRequestConfig {
  headers?: HttpHeaders;
  params?: HttpQuery;
  timeout?: number;
  responseType?: ResponseType;
}

interface RawRequestConfig extends HttpRequestConfig {
  baseURL?: string;
  body?: unknown;
  maxRedirects?: number;
  method: HttpMethod;
  url: string;
}

interface RawResponse {
  body: Buffer;
  headers: IncomingHttpHeaders;
  status: number;
  url: string;
}

interface RequestDescriptor {
  data?: unknown;
  headers?: HttpHeaders;
  method: HttpMethod;
  params?: HttpQuery;
  responseType: ResponseType;
  timeout: number;
  url: string;
}

const httpAgent = new HttpAgent({keepAlive: true});
const httpsAgent = new HttpsAgent({keepAlive: true});

export interface HttpResponse<T> {
  config: RequestDescriptor;
  data: T;
  headers: IncomingHttpHeaders;
  request: {
    res: {
      responseUrl: string;
    };
  };
  status: number;
}

export class HttpStatusError extends Error {
  body: Buffer;
  headers: IncomingHttpHeaders;
  statusCode: number;

  constructor(statusCode: number, headers: IncomingHttpHeaders, body: Buffer) {
    super(`Request failed with status code ${statusCode}`);
    this.name = 'HttpStatusError';
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = body;
  }
}

export class HttpClient {
  defaults: {
    baseURL?: string;
    headers: HttpHeaders;
    maxRedirects: number;
    params: HttpQuery;
    timeout: number;
  };

  constructor(
    defaults: {
      baseURL?: string;
      headers?: HttpHeaders;
      maxRedirects?: number;
      params?: HttpQuery;
      timeout?: number;
    } = {},
  ) {
    this.defaults = {
      baseURL: defaults.baseURL,
      headers: defaults.headers ? normalizeHeaders(defaults.headers) : {},
      maxRedirects: defaults.maxRedirects ?? 5,
      params: defaults.params ? {...defaults.params} : {},
      timeout: defaults.timeout ?? 15000,
    };
  }

  get<T = unknown>(url: string, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, config);
  }

  post<T = unknown>(url: string, body?: unknown, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, body, config);
  }

  head(url: string, config: Omit<HttpRequestConfig, 'responseType'> = {}): Promise<HttpResponse<Buffer>> {
    return this.request<Buffer>('HEAD', url, undefined, {...config, responseType: 'buffer'});
  }

  private async request<T>(
    method: HttpMethod,
    url: string,
    body?: unknown,
    config: HttpRequestConfig = {},
  ): Promise<HttpResponse<T>> {
    const responseType = config.responseType ?? 'json';
    const timeout = config.timeout ?? this.defaults.timeout;
    const headers = normalizeHeaders({...this.defaults.headers, ...config.headers});
    const params = {...this.defaults.params, ...config.params};

    const rawResponse = await requestRaw({
      baseURL: this.defaults.baseURL,
      body,
      headers,
      maxRedirects: this.defaults.maxRedirects,
      method,
      params,
      timeout,
      url,
    });

    return {
      config: {
        data: body,
        headers,
        method,
        params,
        responseType,
        timeout,
        url,
      },
      data: parseResponseBody<T>(rawResponse, responseType),
      headers: rawResponse.headers,
      request: {
        res: {
          responseUrl: rawResponse.url,
        },
      },
      status: rawResponse.status,
    };
  }
}

const requestRaw = async (config: RawRequestConfig, redirectCount = 0): Promise<RawResponse> => {
  const requestUrl = buildUrl(config.url, config.baseURL, config.params);
  const headers = normalizeHeaders(config.headers);
  const serializedBody = serializeBody(config.body, headers);

  if (serializedBody && !headers['content-length']) {
    headers['content-length'] = String(serializedBody.length);
  }

  return await new Promise<RawResponse>((resolve, reject) => {
    const isHttps = requestUrl.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const req = requestFn(
      {
        agent: isHttps ? httpsAgent : httpAgent,
        headers,
        hostname: requestUrl.hostname,
        method: config.method,
        path: requestUrl.pathname + requestUrl.search,
        port: requestUrl.port,
        protocol: requestUrl.protocol,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const locationHeader = response.headers.location;
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;

        if (location && isRedirectStatus(status) && redirectCount < (config.maxRedirects ?? 5)) {
          response.resume();
          const redirectedMethod =
            status === 303 || ((status === 301 || status === 302) && config.method === 'POST') ? 'GET' : config.method;
          const redirectedHeaders = {...headers};
          if (redirectedMethod === 'GET' || redirectedMethod === 'HEAD') {
            delete redirectedHeaders['content-length'];
            delete redirectedHeaders['content-type'];
          }

          requestRaw(
            {
              ...config,
              baseURL: undefined,
              body: redirectedMethod === 'POST' ? config.body : undefined,
              headers: redirectedHeaders,
              method: redirectedMethod,
              url: new URL(location, requestUrl).toString(),
            },
            redirectCount + 1,
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          try {
            const body = decodeResponseBuffer(Buffer.concat(chunks), response.headers['content-encoding']);
            if (status < 200 || status >= 300) {
              reject(new HttpStatusError(status, response.headers, body));
              return;
            }

            resolve({
              body,
              headers: response.headers,
              status,
              url: requestUrl.toString(),
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(config.timeout ?? 15000, () => {
      req.destroy(new Error(`Request timed out after ${config.timeout ?? 15000}ms`));
    });

    if (serializedBody) {
      req.write(serializedBody);
    }

    req.end();
  });
};

const buildUrl = (url: string, baseURL?: string, params?: HttpQuery): URL => {
  const parsedUrl = new URL(resolveUrl(url, baseURL));

  if (params) {
    for (const [key, input] of Object.entries(params)) {
      if (Array.isArray(input)) {
        for (const value of input) {
          if (value !== undefined && value !== null) {
            parsedUrl.searchParams.append(key, String(value));
          }
        }
      } else if (input !== undefined && input !== null) {
        parsedUrl.searchParams.set(key, String(input));
      }
    }
  }

  return parsedUrl;
};

const resolveUrl = (url: string, baseURL?: string): string => {
  if (!baseURL || isAbsoluteUrl(url)) {
    return url;
  }

  return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
};

const normalizeHeaders = (headers: HttpHeaders = {}): HttpHeaders => {
  const normalizedHeaders: HttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }
  return normalizedHeaders;
};

const serializeBody = (body: unknown, headers: HttpHeaders): Buffer | undefined => {
  if (body === undefined) {
    return undefined;
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === 'string') {
    return Buffer.from(body);
  }

  if (!headers['content-type']) {
    headers['content-type'] = 'application/json; charset=UTF-8';
  }

  return Buffer.from(JSON.stringify(body));
};

const decodeResponseBuffer = (buffer: Buffer, contentEncoding?: string | string[]): Buffer => {
  const encoding = (Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding)?.split(',')[0]?.trim();

  switch (encoding) {
    case 'br':
      return brotliDecompressSync(buffer);
    case 'deflate':
      return inflateSync(buffer);
    case 'gzip':
      return gunzipSync(buffer);
    default:
      return buffer;
  }
};

const parseResponseBody = <T>(response: RawResponse, responseType: ResponseType): T => {
  if (responseType === 'buffer') {
    return response.body as unknown as T;
  }

  const text = response.body.toString('utf-8');
  if (responseType === 'text') {
    return text as unknown as T;
  }

  return JSON.parse(text) as T;
};

const isRedirectStatus = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

const isAbsoluteUrl = (url: string): boolean => /^[a-z][a-z\d+\-.]*:\/\//i.test(url);

const defaultClient = new HttpClient();

export const getBuffer = async (url: string, config: HttpRequestConfig = {}): Promise<Buffer> =>
  (await defaultClient.get<Buffer>(url, {...config, responseType: 'buffer'})).data;

export const getJson = async <T = unknown>(url: string, config: HttpRequestConfig = {}): Promise<T> =>
  (await defaultClient.get<T>(url, {...config, responseType: 'json'})).data;

export const getText = async (url: string, config: HttpRequestConfig = {}): Promise<string> =>
  (await defaultClient.get<string>(url, {...config, responseType: 'text'})).data;

export const headRequest = async (
  url: string,
  config: Omit<HttpRequestConfig, 'responseType'> = {},
): Promise<HttpResponse<Buffer>> => await defaultClient.head(url, config);
