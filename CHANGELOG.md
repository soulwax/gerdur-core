# Changelog

## 2.4.0 - 2026-08-31

Phase 3.3 — deterministic retries and typed errors.

### Fixed

- **The gateway retry loop had no cap** on `error.code === 4`,
  `NEED_API_AUTH_REQUIRED`, or `GATEWAY_ERROR` — a failing endpoint could spin
  forever. `requestWithRetry` is now a bounded loop: per-class attempt caps
  (`code 4` ×6, re-auth ×3, token refresh ×15), full-jittered exponential
  backoff, and a 30 s wall-clock deadline. On exhaustion it throws.

### Added

- **`DeezerError`** (`extends Error`) — thrown for gateway / media-API failures
  instead of `new Error(Object.entries(error).join(', '))`. Carries `code`,
  `keys`, `retryable`, and the raw `payload`. `message` stays human-readable.
- **`RETRY_POLICY`** — the exported, inspectable retry configuration.

### Changed

- Gateway helpers (`request`, `requestLight`, `requestGet`, `requestPublicApi`)
  and `resolveDownloadUrls` now throw `DeezerError`. `message` text changed shape
  (`"KEY: value"` rather than `"KEY,value"`); read `err.code` / `err.keys`
  instead of matching the string.

## 2.3.0 - 2026-08-31

Phase 2.1 — all the formats, and previews. Additive; the `1 / 3 / 9` path is
unchanged.

### Added

- **`getTrackPreview(track)` / `downloadPreview(track)`** — the 30-second preview
  clip. A plain MP3: no licence, no `arl`, no Blowfish. Accepts a gw track (reads
  `MEDIA`, no extra request), a track id, or a number.
- **`DEEZER_FORMATS`** — every format `get_url` understands, best → worst
  (`FLAC`, `MP3_320`, `MP3_256`, `MP3_128`, `MP3_64`, `AAC_64`, `MP4_RA3/2/1`).
- **`resolveDownloadUrls(tracks, qualities)`** now accepts format strings in the
  preference list (`['FLAC', 'MP3_320', 'AAC_64']`), not just `1 | 3 | 9`. Each
  `ResolvedUrl` gains `cipher` (`'BF_CBC_STRIPE'` | `'NONE'`).
- **`toFormat(quality)`** — normalise a number or format string to the `get_url`
  format string. `formatName` now also accepts format strings (identity).
- `Quality` / `DeezerFormat` exported types.

### Changed

- `isEncrypted` (from `getTrackDownloadUrl` and `resolveDownloadUrls`) is now
  taken from the media API's `cipher` field instead of guessing from the URL
  path — authoritative, and correct for `cipher: NONE` content.
- `trackType.FILESIZE_*` fields are typed `string` (several were mistyped as the
  literal `'0'`); added `FILESIZE_MP3_MISC` / `FILESIZE_MHM1_RA*`.

## 2.2.0 - 2026-08-31

Phase 2.4 — browse & discovery. All additive, all on the public REST API (no
`arl` needed), all memoised.

### Added

- **Charts / editorial**: `getGenres`, `getChart(genreId, limit)` (the five
  ranked lists), `getChartTracks`, `getGenreArtists`, `getEditorialList`,
  `getEditorialReleases`, `getEditorialSelection`, `getEditorialCharts`.
- **Artist discovery**: `getArtistTopTracks`, `getRelatedArtists`,
  `getArtistAlbums`, `getArtistPlaylists`, `getArtistRadioTracks`.
- **ISRC / UPC resolution**: `getTrackByISRC(isrc)` and `getAlbumByUPC(upc)` —
  raw public-API track/album (with `bpm`, `gain`, `preview`, embedded `tracks`).
  Complements the converter's `isrc2deezer` / `upc2deezer`, which hydrate a gw
  track instead.
- New exported types: `chartType`, `chartTrack`/`chartAlbum`/`chartArtist`/
  `chartPlaylist`/`chartPodcast`, `genreType`, `editorialType`,
  `artistAlbumResult`, `publicApiList<T>`.

## 2.1.0 - 2026-08-31

Phase 2.5 — search, properly. All additive.

### Added

- **`searchPublicApi(query, options?)`** — search the public REST API
  (`api.deezer.com/search`) rather than the internal `pageSearch` gateway.
  Returns clean public-API objects (`isrc`, `preview`, `rank`, numeric ids) and
  takes `type` (`track` | `album` | `artist` | `playlist` | `user` | `radio` |
  `podcast`), `order`, `strict`, and `limit` / `index` paging. No auth required.
- **`searchTracks` / `searchAlbums` / `searchArtists` / `searchPlaylists`** —
  thin typed wrappers over `searchPublicApi` with the entity fixed.
- **`buildAdvancedQuery(filters)`** — pure helper that composes Deezer's advanced
  operators into one query string: `{artist, album, track, label}` →
  `artist:"…"`, `{durMin, durMax, bpmMin, bpmMax}` → `dur_min:NNN` / `bpm_min:NNN`,
  free-text `query` first. Reliable on the track index only (Deezer's
  `/search/album` and `/search/artist` ignore the operators).
- **`suggest(query, nb?)`** — the `deezer.suggest` autocomplete endpoint, for
  "as you type" UIs; cheaper than a full `searchMusic`.
- New exported types: `advancedSearchFilters`, `searchOrder`, `searchEntity`,
  `publicApiSearchOptions`, `publicApiSearchResponse<T>`, `searchResultTrack`,
  `searchResultAlbum`, `searchResultArtist`, `searchResultPlaylist`,
  `suggestResult`.

### Fixed

- **`getPlaylistChannel`** returned `MISSING_PARAMETER_PAGE` — the nested
  `gateway_input` was serialised as `[object Object]`. It is now JSON-stringified
  before the request, so channel pages resolve again.

## 2.0.0 - 2026-08-31

Metadata overhaul — extract everything Deezer actually exposes for a track.

### Breaking

- **`addTrackTags(buffer, track, options)`** — the third argument is now an
  options object, not a cover-size number, and it resolves to
  **`{buffer, model}`** instead of a bare `Buffer`. Migrate:
  `await addTrackTags(buf, track, 500)` → `(await addTrackTags(buf, track, {coverSize: 500})).buffer`.
  `model` is the full `TrackTagModel` (all resolved fields + `model.lyricsSynced`,
  an LRC document).
- `writeMetadataMp3` / `writeMetadataFlac` now take the `TrackTagModel`, not a
  raw track + public-album payload.
- `downloadAlbumCover` clamps its size to Deezer's real ceiling of **1800**
  (was unbounded); `coverSize` is re-exported from here.

### Added

- **ReplayGain** — `GAIN` (present on every `song.getData`) is written as
  `REPLAYGAIN_TRACK_GAIN` (`TXXX` on MP3, Vorbis comment on FLAC).
- **Rich credits** via `normalizeContributors()` — `SNG_CONTRIBUTORS` has
  inconsistent keys across the catalogue (`main_artist` / `mainartist` / `artist`,
  `music publisher` with a space, …); this normalises them and surfaces
  `featuring`, mastering / mixing / recording engineers, producers, mixers,
  performers.
- **Featured artists** from `SNG_CONTRIBUTORS.featuring` → `TXXX:FEATURING` /
  `FEATURING`, plus a combined `ARTISTS` tag.
- **Original release date** — `getRichAlbum()` merges gw `album.getData`
  (`ORIGINAL_RELEASE_DATE`, `COPYRIGHT`/`PRODUCER_LINE`, `NUMBER_DISK`,
  `SUBTYPES`) with the public `/album/` (label, genres, record type). Writes
  `ORIGINALDATE`/`ORIGINALYEAR` distinct from the reissue `DATE`.
- **BPM** from the public `/track/` endpoint (`TBPM` + precise `TXXX:BPM`).
- **Synced lyrics** — `toLrc()` renders `LYRICS_SYNC_JSON` (already fetched with
  the plain lyrics) as an LRC document, exposed on `model.lyricsSynced` and
  embedded in FLAC `LYRICS`.
- Real `©` / `℗` lines, disc totals, compilation/live flags from `SUBTYPES`,
  proper `EXPLICIT_LYRICS_STATUS` enum handling (`1`/`4` = explicit; `2`/`6` =
  unknown, not "explicit"), `iTunesAdvisory`, Deezer track/album/artist/label/
  provider ids, `URL_REWRITING` slug, popularity rank, and the artist photo as a
  second embedded picture.
- New exports: `getRichAlbum`, `RichAlbum`, `normalizeContributors`,
  `NormalizedContributors`, `toLrc`, `buildTagModel`, `TrackTagModel`, `Person`,
  `AddTrackTagsOptions`, `TaggedTrack`, `downloadArtistImage`, `MAX_COVER_SIZE`.

### Changed

- Album/playlist tracks (which come without `SNG_CONTRIBUTORS` / `VERSION` /
  `GAIN`) are transparently hydrated with one coalesced `song.getData` before
  tagging. Disable via `addTrackTags(…, {richCredits: false})`.

## 1.0.4 - 2026-08-31

### Added

- `resolveDownloadUrls(tracks, qualities)` — resolve download URLs for a whole album/playlist in **one** `media.deezer.com/v1/get_url` POST (`track_tokens[]` + an ordered `formats[]` fallback), instead of one request per track re-tried per quality. ~19× faster URL resolution for a 14-track album. Returns one `ResolvedUrl | null` per input track, in order. `formatName(quality)` is also exported.
- `httpAgent` / `httpsAgent` — the shared keep-alive connection pools are now exported so downstream apps can hand them to `got`/`undici` and reuse the same sockets for downloads. `getBuffer` / `getJson` / `getText` are exported too.

### Changed

- **Shared HTTP agents are tuned and bounded**: `keepAlive`, `maxSockets: 64` (was the Node default of `Infinity`), `maxFreeSockets: 16`, `scheduling: 'lifo'`, 30 s keep-alive. Caps a pathological fan-out from opening hundreds of sockets to `api.deezer.com`, while leaving generous headroom over the converter's concurrency.
- **In-flight request coalescing** in the API layer: concurrent identical gateway / public-API calls (e.g. every track of one album asking for the same album info while tagging) now share a single request instead of each missing the still-empty cache and hitting the wire.

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
