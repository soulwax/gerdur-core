import './lib/session-augment'; // wires the download methods onto Session.prototype

export {initDeezerApi, createSession, defaultSession, Session, RETRY_POLICY, DEFAULT_ARL} from './lib/session';
export type {SessionUserData} from './lib/session';
export {DeezerError} from './lib/errors';
export type {DeezerErrorPayload} from './lib/errors';
export {configureCache, cacheStats, clearSharedCaches} from './lib/caches';
export type {CacheOptions, CacheStats} from './lib/caches';
export * from './api';
export * from './converter';
export * from './lib/decrypt';
export * from './lib/get-url';
export * from './lib/stream-download';
export {
  createPooledDecryptStream,
  configureDecryptPool,
  decryptPoolStats,
  shutdownDecryptPool,
} from './lib/decrypt-pool';
export type {DecryptPoolOptions} from './lib/decrypt-pool';
export * from './enrich';
export {httpAgent, httpsAgent, getBuffer, getJson, getText, getStream} from './lib/http';
export type {StreamResponse} from './lib/http';
export * from './metadata-writer';
