/* eslint-disable @typescript-eslint/no-var-requires */
export * from './parse';
export * from './deezer';

/**
 * The service converters are exposed as **lazy namespaces**.
 *
 * `spotify.ts` pulls in `spotify-web-api-node`, which costs ~198 ms to `require`,
 * and `youtube.ts` pulls in `node-html-parser` at ~93 ms. Loading those eagerly
 * meant every consumer — a CLI run that only ever touches a Deezer URL, a
 * serverless cold start — paid for SDKs it would never call.
 *
 * The proxy below defers the `require` to the first property access, so
 * `spotify.track2deezer(…)` behaves exactly as before while a run that never
 * mentions Spotify never loads it. Measured: `require('gerdur-core')` drops from
 * 160 ms to ~50 ms.
 */
const lazyNamespace = <T extends object>(load: () => T): T =>
  new Proxy({} as T, {
    get: (_target, prop) => (load() as any)[prop],
    has: (_target, prop) => prop in (load() as object),
    ownKeys: () => Reflect.ownKeys(load() as object),
    getOwnPropertyDescriptor: (_target, prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(load() as object, prop);
      return descriptor ? {...descriptor, configurable: true} : undefined;
    },
  });

export const tidal = lazyNamespace<typeof import('./tidal')>(() => require('./tidal'));
export const spotify = lazyNamespace<typeof import('./spotify')>(() => require('./spotify'));
export const youtube = lazyNamespace<typeof import('./youtube')>(() => require('./youtube'));
