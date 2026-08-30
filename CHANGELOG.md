# Changelog

## 1.0.1 - 2026-08-30

Initial public release.

- Deezer gateway client with transparent token refresh and rate-limit backoff, on a dependency-light internal HTTP transport.
- Spotify / Tidal / YouTube URL resolution to Deezer tracks via ISRC and UPC matching.
- Blowfish stripe decryption (`decryptDownload`), download-URL resolution with licence and geo checks (`getTrackDownloadUrl`), ID3 / FLAC metadata writing (`addTrackTags`).
- Shared TypeScript types, also published as the `gerdur-core/types` subpath.
