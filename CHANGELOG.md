# Changelog

## 1.0.3 - 2026-08-30

### Changed

- `getTrackDownloadUrl`: when `media.deezer.com/v1/get_url` returns 403/429/5xx (throttling or a stale license token), re-authenticate and retry with exponential backoff (up to 3×); if it still fails, fall through to the token-free legacy CDN instead of throwing.

## 1.0.2 - 2026-08-30

### Fixed

- **`decryptDownload` now works on Node >= 17 / OpenSSL 3.** It used `crypto('bf-cbc')`, which OpenSSL 3 disables by default (`ERR_OSSL_EVP_UNSUPPORTED`). Replaced with a correct, dependency-free Blowfish (~290 MiB/s). Verified against the canonical Blowfish test vectors and a real-track fixture (`__tests__/decrypt.ts`).

### Added

- `TrackDecryptStream` — decrypt a track from ordered socket chunks (`write()` / `final()`); constant memory, CPU work hides behind the network read.
- `ExpiredTrackToken` error — thrown by `getTrackDownloadUrl` when `TRACK_TOKEN_EXPIRE` has passed or the media API returns code 2000/2001. Re-fetch the track with `getTrackInfo(SNG_ID)` and retry.

### Changed

- Internal LRU (`fast-lru`) rewritten around `Map` insertion order — O(1) eviction (was O(n log n) per write once full) and true LRU semantics (was LFU).

## 1.0.1 - 2026-08-30

Initial public release.

- Deezer gateway client with transparent token refresh and rate-limit backoff, on a dependency-light internal HTTP transport.
- Spotify / Tidal / YouTube URL resolution to Deezer tracks via ISRC and UPC matching.
- Blowfish stripe decryption (`decryptDownload`), download-URL resolution with licence and geo checks (`getTrackDownloadUrl`), ID3 / FLAC metadata writing (`addTrackTags`).
- Shared TypeScript types, also published as the `gerdur-core/types` subpath.
