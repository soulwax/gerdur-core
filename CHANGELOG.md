# Changelog

## 2.15.0 - 2026-08-31

Streaming tag write — tagging no longer holds the audio.

### Added

- **`createTagStream(model, options?)`** — a `Transform` that rewrites a track's
  tags as bytes flow through it. `addTrackTags` has to materialise the whole
  file (`browser-id3-writer` allocates `audio.length + tag` and copies the audio
  in, plus another copy to strip an existing ID3v2; the FLAC path concatenates
  the same way), which is what caps concurrency on a server and what cancelled
  `streamTrackDownload`'s constant-memory guarantee at the last step.

  Both containers keep their metadata at the front, so none of that copying is
  needed: MP3 emits a fresh ID3v2 and discards exactly the old tag's bytes as
  they pass; FLAC buffers only the metadata block chain and passes the frames
  through untouched. Peak memory is O(metadata), not O(file).

  Measured, 40 MB tracks: **4 concurrent 239 MB -> 0 MB; 16 concurrent 965 MB ->
  0 MB, and 6.5x faster** (986 ms -> 150 ms) from skipping the copies. Output is
  byte-identical to `addTrackTags` — the tag bytes come from the same writers,
  called with an empty / truncated source so they emit only the header.
- **`resolveTagModel(track, options?)`** — the metadata resolution half of
  `addTrackTags` (album, lyrics, cover, artist image, credits, BPM) without
  touching audio, so a streaming caller can get a model to hand to
  `createTagStream`. Same options, same coalescing. `addTrackTags` is now a thin
  wrapper over it — no behaviour change.
- **`probeAudioOffset(buffer)`** — where the audio starts in a source and which
  container it is; exported for callers doing their own muxing.
- `__tests__/tag-stream.ts` — byte-identical output asserted across chunk sizes
  from 1 byte to whole-file, for MP3 and FLAC, with and without a pre-existing
  tag.

### Changed

- README: streaming tag write documented under **Tag MP3 / FLAC** and in
  **Running this on a server**.

## 2.14.0 - 2026-08-31

Multi-tenant caching — for backends where many accounts share one process.

### Added

- **Shared gateway metadata cache.** Most gw payloads embed a per-account
  `TRACK_TOKEN`, so each `Session` keeps its own cache. Five methods carry
  nothing account-scoped — `album.getData`, `artist.getData`, `song.getLyrics`,
  `album.getDiscography`, `playlist.getData` — and now go to a process-wide cache
  **partitioned by country**, with a shared in-flight map so a concurrent burst
  collapses into one request. Measured with 500 sessions reading the same album:
  **500 gateway requests → 1**, and 1.8 MB of duplicated payload → one copy.
  Track-bearing methods (`song.getData`, `playlist.getSongs`,
  `song.getListByAlbum`, `song.getListData`, `episode.getData`, `mobile.*`,
  `deezer.pageSearch`, `user_getInfo`, …) are never shared.
- **`configureCache({shared: {maxSize, ttl}})`** — size the shared cache to your
  catalogue. Default `{maxSize: 2000, ttl: 3_600_000}`.
- **`cacheStats()`** → `{shared: {size, maxSize, hits, misses, inFlight}}` — for
  a `/metrics` or health endpoint.
- **`clearSharedCaches()`** — drops the shared cache; per-session caches are
  untouched.
- `__tests__/caches.ts` — offline tests pinning the isolation guarantees: no
  cross-account token reuse, no cross-country bleed, in-flight entries released.
- README: a **Running this on a server** section (stream don't buffer, decrypt is
  on the event loop, size the cache, evict idle sessions).

### Not done, deliberately

- Memoising the initialised Blowfish key schedule per track was implemented,
  measured and **reverted**: key setup is 39.7 µs against 33 ms to decrypt an
  8 MiB file — **0.12%**, with break-even at ~10 KiB decrypted per key. Not worth
  a cache or the public knob it would need.

## 2.13.3 - 2026-08-31

### Docs

- **`MIGRATING.md`** — a migration guide from `@soulwax/d-fi-core`: dependency
  swap, import rename, the one breaking `addTrackTags` change, the local
  workarounds that can now be deleted (OpenSSL-3 Blowfish fallback, per-track
  URL-retry loops, manual album-info caching, `code === 4` spin guards), and the
  faster primitives to adopt (`downloadTrackBuffer`, batch `resolveDownloadUrls`,
  `streamTrackDownload`, `Session` / `createSession`, `DeezerError`). Linked from
  the README and shipped in the package.

## 2.13.2 - 2026-08-31

### Changed

- **Licensed under MIT.** The `LICENSE` file was empty and `package.json` said
  `"SEE LICENSE IN LICENSE"`; both now state MIT.

## 2.13.1 - 2026-08-31

### Docs

- **README rewritten** — restructured around use cases (a task-oriented guide
  covering auth, lookups, URL/ISRC/UPC resolution, both search APIs, browse,
  Flow/library, podcasts, previews, URL resolution, buffered and streamed
  downloads, decryption, tagging, enrichment, multi-account sessions and the HTTP
  helpers), a full collapsible API reference, an errors table and a types
  summary. npm-facing tone: badges, single-line description, no internal-project
  references.
- `package.json` `description` rewritten and `keywords` added for npm search.

No code changes.

## 2.13.0 - 2026-08-31

### Added

- **`getCoverArtByISRC(isrc, {minSize?, maxTries?})`** and
  **`getRecordingCoverArt(recording, …)`** — the full ISRC → cover chain with a
  proper release ranking: `getBestCoverArtUrl` on the *first* release a recording
  lists often hits a promo comp / bootleg with no art. These walk the
  release-groups **canonical-first** (Official > Album > earliest date) and
  return the first real front cover, bounded to `maxTries` (default 4) lookups.

## 2.12.0 - 2026-08-31

Phase 4 — an optional, read-only **enrichment** layer against open databases.
Off by default, never touches `addTrackTags`.

### Added

- **MusicBrainz** (`src/enrich/`): `lookupRecordingByISRC(isrc)` — canonical
  recording (title, artist credits, length, every known ISRC, the releases it's
  on); `getMusicBrainzRecording(mbid)` / `getMusicBrainzRelease(mbid, inc?)` —
  direct MBID lookups with label / catalogue number / barcode.
  `configureMusicBrainz({userAgent, minIntervalMs})` — they require a descriptive
  UA and ≤ 1 req/s.
- **Cover Art Archive**: `getCoverArt(mbid, entity?)` and
  `getBestCoverArtUrl(mbid, {minSize})` — higher-resolution covers than Deezer's
  1800 px ceiling. `null` when there's no art.
- **`PoliteJsonClient`** — the serialised, rate-limited, `503`/`429`-retrying,
  `404`→`null` JSON client both use; exported for building your own.

## 2.11.0 - 2026-08-31

### Added

- **`searchFacets(result)`** — flatten the per-type hit counts + Deezer's
  relevance `order` out of a `searchMusic` result.

### Internal

- The live-API test suite skips more gracefully when an upstream (Deezer public
  REST, Tidal, YouTube) rate-limits or consent-walls the runner — the
  `--> DEEZER` converter tests and YouTube tests now degrade to a skip instead
  of a hard fail.

## 2.10.0 - 2026-08-31

Leftovers — batch token refresh + podcast episodes. Additive.

### Added

- **`refreshTrackTokens(tracks, {graceSeconds?, session?})`** — one
  `song.getListData` request refreshes every `TRACK_TOKEN` that has expired (or
  is about to). Run a long playlist through this before `resolveDownloadUrls` so
  it doesn't die on stale tokens at track 40. Also `session.refreshTrackTokens`.
- **`getEpisode(episodeId)`** (`episode.getData`) and **`getShowEpisodes(showId,
  nb?, start?)`** — podcast episodes; `EPISODE_DIRECT_STREAM_URL` is a plain MP3
  (no licence, no decryption).

## 2.9.0 - 2026-08-31

Phase 3.2 (cont.) — downloads are session-aware. Additive.

### Added

- **`Session.getTrackDownloadUrl` / `resolveDownloadUrls` / `streamTrack` /
  `getTrackBuffer`** — resolve and download **as a specific account**, so a
  `createSession(arl)` client is now end-to-end usable.
- **`downloadTrackBuffer(track, quality, options?)`** — download + decrypt a
  track fully into a `Buffer` (no tagging), free-function form of
  `session.getTrackBuffer`.
- `getTrackDownloadUrl(track, quality, session?)`, `resolveDownloadUrls(tracks,
  qualities?, session?)` and `streamTrackDownload(track, quality, {session})`
  gained an optional session argument (defaults to the process default).

## 2.8.0 - 2026-08-31

Phase 3.2 (cont.) — a `Session` is now usable per-account. Additive; free
functions unchanged.

### Added

- **`Session` query methods**: `getUser`, `getTrackInfo`, `getLyrics`,
  `getAlbumInfo`, `getAlbumTracks`, `getPlaylistInfo`, `getPlaylistTracks`,
  `getArtistInfo`, `getDiscography`, `getProfile`, `searchMusic` — plus the raw
  channels `gw` / `gwLight` / `gwGet`. So `createSession(arl)` gives you an
  isolated client you can actually query, not just inspect.
- Each `Session` has **its own response cache** (`session.cache`) — gateway
  responses carry account-specific `TRACK_TOKEN`s, so sharing one cache across
  accounts was wrong.

### Changed

- `request` / `requestLight` / `requestGet` are now thin wrappers over
  `defaultSession()`. **`initDeezerApi(newArl)` now clears the default session's
  cache** — previously a new account could be served the old account's cached
  track tokens.

## 2.7.0 - 2026-08-31

Phase 3.2 — session lifecycle. The scattered module-level state
(`request.ts`: `arl` / `sid` / `api_token`; `get-url.ts`: `license_token` /
`country` / streaming rights) is consolidated into one **`Session`** object.
Backwards compatible — `initDeezerApi` and every free function are unchanged.

### Added

- **`Session`** — owns one account's `arl`, HTTP client (`sid` / `api_token`),
  `license_token` / `country` / `canStreamLossless` / `canStreamHq`, the
  bounded-retry request loop, and token refresh (`init`, `refreshApiToken`,
  `loadUserData`).
- **`createSession(arl?)`** — an isolated session you hold and inspect, so
  multiple accounts can be used concurrently.
- **`defaultSession()`** — the process-wide session `initDeezerApi` and the free
  functions run against. `setDefaultSession(session)` swaps it.
- `SessionUserData` type; `DEFAULT_ARL` constant.

### Changed

- **Proactive `license_token` refresh** — `loadUserData()` caches the account's
  media-API credentials for 25 min and force-refreshes on a media 403, instead of
  only re-fetching after a failed download. Fewer opaque CDN 403s on long
  playlists.
- `RETRY_POLICY` now lives in `lib/session.ts` (still exported, same shape).

## 2.6.0 - 2026-08-31

Phase 2.4 round 2 — Flow, radios, and a user's library. All public REST, all
memoised, all additive.

### Added

- **Flow / library** (take a `userId`): `getUserFlow`, `getUserFavoriteTracks`
  (with `time_add`), `getUserFavoriteAlbums`, `getUserFavoriteArtists`,
  `getUserPlaylists`, `getUserRadios`, `getUserChartTracks`.
- **Radios**: `getRadios`, `getRadioTracks(radioId)`, `getRadioGenres`.
- New types: `userFavoriteTrack`, `userFavoriteAlbum`, `userFavoriteArtist`,
  `userPlaylistResult`, `radioResult`, `radioGenre`.

### Internal

- Tests run under `ts-node/register/transpile-only` (build still type-checks) —
  the growing live-API suite was hitting the ts-node worker heap limit.
- Live-API tests skip cleanly on Deezer's `code: 4` "Quota limit exceeded"
  instead of failing when the suite bursts the public API.

## 2.5.0 - 2026-08-31

Phase 3.1 — streaming download primitives. Additive.

### Added

- **`streamTrackDownload(track, quality, options?)`** — download a track as a
  stream of decrypted audio (`get_url` → CDN fetch → stripe-decrypt `Transform`
  → your sink). Peak memory is ~one 2048-byte stripe regardless of file size or
  concurrency. `options.onProgress(received, total)`; `options.resumeFrom`
  (bytes, 2048-aligned) sends a `Range` header and resumes stripe decryption
  in phase. Verified byte-identical to the buffered `decryptDownload` path,
  resume included.
- **`createDecryptStream(sngId, startChunk?)`** — a Node `Transform` wrapping the
  stripe cipher, for composing your own pipelines. `TrackDecryptStream` gained a
  `startChunk` constructor arg.
- **`getStream(url, {rangeStart?})`** — a content-decoded response stream from
  the internal HTTP client (`gunzip` / `brotli` / `inflate` handled), following
  redirects, rejecting `HttpStatusError` on non-2xx.

Streaming the tag write (in-place FLAC metadata-block rewrite) is still open.

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
