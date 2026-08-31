# Migrating from `@soulwax/d-fi-core`

`gerdur-core` is the continuation of `@soulwax/d-fi-core`. It was relaunched
clean-slate on 2026-08-30 — new repo, squashed history, published under a new
name — so **`gerdur-core@1.0.1` is the last state of `@soulwax/d-fi-core` with
every identifier renamed**. Everything since (`1.0.1 → 2.13.x`) is additive
except for one call.

**TL;DR:** rename the dependency and the imports, fix one `addTrackTags` call,
and you're done. Then delete the workarounds you no longer need and adopt the
faster primitives below.

---

## 1. Swap the dependency

```bash
npm rm @soulwax/d-fi-core
npm i gerdur-core
```

```jsonc
// package.json
-  "@soulwax/d-fi-core": "^x.y.z"
+  "gerdur-core": "^2.13.2"
```

## 2. Rename imports

Mechanical, whole codebase:

```ts
- import { … } from '@soulwax/d-fi-core';
+ import { … } from 'gerdur-core';

- import type { trackType } from '@soulwax/d-fi-core/types';
+ import type { trackType } from 'gerdur-core/types';   // the /types subpath name is unchanged
```

## 3. Fix the one breaking change — `addTrackTags`

The third argument changed from a cover-size `number` to an options object, and
the return changed from `Buffer` to `{buffer, model}`.

```ts
// before
const out: Buffer = await addTrackTags(audio, track, 500);

// after
const {buffer: out, model} = await addTrackTags(audio, track, {coverSize: 500});
```

- `coverSize` now defaults to **1000** (was 1000 in code but often passed
  explicitly) and is clamped to Deezer's real ceiling of **1800**.
- `model` is the full [`TrackTagModel`](README.md#types) — every resolved field,
  plus `model.lyricsSynced` (an LRC document, ready for a `.lrc` sidecar).

If you called the lower-level writers directly, they now take a `TrackTagModel`
instead of `(buffer, track, album, cover)`:

```ts
// before
writeMetadataMp3(buffer, track, album, cover);
writeMetadataFlac(buffer, track, album, size, cover);

// after — build the model, or just call addTrackTags
import {buildTagModel} from 'gerdur-core';
const model = buildTagModel({track, album, publicTrack, lyrics, cover, coverSize: 1000, deezerIds: true, includeRank: true});
writeMetadataMp3(buffer, model);
writeMetadataFlac(buffer, model, {embedSyncedLyrics: true});
```

## 4. Everything else compiles unchanged

Same names, same signatures, same return shapes:

- `initDeezerApi(arl)` — still `Promise<string>` (the gateway `SESSION` id); the
  `arl` must still be exactly 192 characters.
- `getTrackInfo` · `getTrackInfoPublicApi` · `getLyrics` · `getAlbumInfo` ·
  `getAlbumInfoPublicApi` · `getAlbumTracks` · `getPlaylistInfo` ·
  `getPlaylistTracks` · `getArtistInfo` · `getDiscography` · `getProfile` ·
  `getUser` · `getChannelList` · `getShowInfo` · `getPlaylistChannel`
- `searchMusic` · `searchAlternative`
- `getTrackDownloadUrl(track, 1 | 3 | 9)` → `{trackUrl, isEncrypted, fileSize} | null`
- `decryptDownload(buffer, sngId)` · `getSongFileName(track, quality)`
- `WrongLicense` · `GeoBlocked`
- `parseInfo` · `getUrlParts` · `isrc2deezer` · `upc2deezer`
- the `spotify` · `tidal` · `youtube` converter namespaces

## 5. Delete your workarounds

If your integration carried any of these, remove them — `gerdur-core` handles it
now:

| Workaround you probably wrote | Now handled by |
| :--- | :--- |
| `egoroof-blowfish` / manual `bf-cbc` fallback for `ERR_OSSL_EVP_UNSUPPORTED` on Node 17+ / OpenSSL 3 | native, dependency-free Blowfish since `1.0.2` (~290 MiB/s), verified against the canonical test vectors |
| per-track `for (const q of [9,3,1]) try { getTrackDownloadUrl(track, q) }` retry loops | `getTrackDownloadUrl` / `resolveDownloadUrls` — media-API 403/429/5xx triggers re-auth + backoff, then a token-free legacy-CDN fallback instead of throwing |
| a guard against `requestWithRetry` spinning forever on `error.code === 4` | `RETRY_POLICY` — per-error-class attempt caps + a 30 s wall-clock deadline; throws `DeezerError` on exhaustion |
| a `Map` / object cache of album info while tagging a whole album | LRU + in-flight coalescing in the API layer — each metadata endpoint is hit once per album automatically |
| `isEncrypted = url.includes('/mobile/')` heuristics | `resolved.isEncrypted` now comes from the media API's `cipher` field — authoritative |
| clearing a cache yourself when switching `arl` | `initDeezerApi(newArl)` clears the default session cache |
| buffering the whole file twice (download, then decrypt) | `streamTrackDownload` — constant memory, ~one 2048-byte stripe |

## 6. Adopt the faster primitives

### One-call download

The `getTrackDownloadUrl` → fetch → `decryptDownload` sequence collapses to:

```ts
import {downloadTrackBuffer} from 'gerdur-core';
const audio = await downloadTrackBuffer(track, 3); // Buffer | null — URL resolve, retries and decrypt inside
```

### Batch URL resolution — one request per album, not N

```ts
import {refreshTrackTokens, resolveDownloadUrls} from 'gerdur-core';

const fresh = await refreshTrackTokens(tracks);                       // one request; refreshes tokens older than ~1 h
const urls  = await resolveDownloadUrls(fresh, ['FLAC', 'MP3_320', 'MP3_128']);
// urls[i] = {trackUrl, isEncrypted, fileSize, format, cipher} | null — Deezer returns the best each is licensed for
```

`resolveDownloadUrls` is a single `media.deezer.com/v1/get_url` POST for the
whole list — roughly **19× faster** than the old per-track-per-quality loop for a
14-track album. `refreshTrackTokens` first prevents the classic "long playlist
starts 403-ing partway through" (tokens expire after ~1 h).

### Streaming — constant memory + resume

```ts
import {pipeline} from 'stream/promises';
import {createWriteStream, existsSync, statSync} from 'fs';
import {streamTrackDownload} from 'gerdur-core';

const {stream, startedAt} = await streamTrackDownload(track, 9, {
  resumeFrom: existsSync(f) ? statSync(f).size : 0, // snapped to a 2048-byte stripe boundary
  onProgress: (received, total) => …,
});
await pipeline(stream, createWriteStream(f, {flags: startedAt ? 'a' : 'w'}));
```

Or drop `createDecryptStream(sngId, startChunk)` into a pipeline you already own.

### Multi-account without global state

The module-level `arl` / session / `license_token` are gone into a `Session`:

```ts
import {createSession} from 'gerdur-core';

const a = await createSession(arlOne);
const b = await createSession(arlTwo);
const track = await a.getTrackInfo('3135556');
const audio = await a.getTrackBuffer(track, 9); // isolated arl, tokens, and response cache
```

`initDeezerApi` still works — it is now a thin shim over a process-wide default
session.

### Typed errors

```ts
import {DeezerError, GeoBlocked, WrongLicense, ExpiredTrackToken} from 'gerdur-core';

try {
  await downloadTrackBuffer(track, 9);
} catch (err) {
  if (err instanceof DeezerError) console.error(err.code, err.keys, err.retryable);
  if (err instanceof ExpiredTrackToken) { /* re-fetch the track and retry */ }
}
```

### Richer tags, fed once

```ts
const {buffer, model} = await addTrackTags(audio, track, {album, lyrics, cover}); // skip the refetch
if (model.lyricsSynced) writeFileSync(f.replace(/\.\w+$/, '.lrc'), model.lyricsSynced);
```

`addTrackTags` now also writes ReplayGain, BPM, real `©` / `℗` lines, the
original (vs reissue) release date, full engineer / producer / performer credits,
featured artists, ISRC / UPC, a proper explicit-status enum, Deezer ids, and the
artist photo as a second embedded image.

### New read surfaces

Mostly no auth required:

- **Search** — `searchPublicApi` / `searchTracks` / `searchAlbums` / … ,
  `buildAdvancedQuery`, `suggest`, `searchFacets`
- **Browse** — `getChart`, `getGenres`, `getRelatedArtists`, `getArtistTopTracks`,
  `getEditorialReleases`, …
- **Resolve codes** — `getTrackByISRC`, `getAlbumByUPC`
- **Flow / library / radios** — `getUserFlow`, `getUserFavoriteTracks`,
  `getRadioTracks`, …
- **Podcasts** — `getEpisode`, `getShowEpisodes`
- **Previews** — `getTrackPreview`, `downloadPreview` (licence-free 30 s MP3, no
  `arl`, no decryption — good for tests / CI)

### Enrichment — covers larger than Deezer's 1800 px cap

```ts
import {configureMusicBrainz, getCoverArtByISRC, getBuffer, addTrackTags} from 'gerdur-core';

configureMusicBrainz({userAgent: 'my-app/1.0 ( me@example.com )'});
const coverUrl = await getCoverArtByISRC(track.ISRC, {minSize: 1200});
if (coverUrl) await addTrackTags(audio, track, {cover: await getBuffer(coverUrl)});
```

### Shared socket pool

```ts
import {httpAgent, httpsAgent, getBuffer, getJson, getStream} from 'gerdur-core';
// hand httpAgent / httpsAgent to your own got/undici calls to reuse the same keep-alive sockets
```

---

## Before / after

```ts
// ── before: @soulwax/d-fi-core ───────────────────────────────────────────────
import got from 'got';
import {initDeezerApi, getTrackInfo, getTrackDownloadUrl, decryptDownload, addTrackTags} from '@soulwax/d-fi-core';

await initDeezerApi(arl);
const track = await getTrackInfo('3135556');
const {trackUrl, isEncrypted} = (await getTrackDownloadUrl(track, 3))!;
const body = (await got(trackUrl, {responseType: 'buffer'})).body;
const audio = isEncrypted ? decryptDownload(body, track.SNG_ID) : body;
const tagged = await addTrackTags(audio, track, 500);          // Buffer
fs.writeFileSync('out.mp3', tagged);

// ── after: gerdur-core ──────────────────────────────────────────────────────
import {initDeezerApi, getTrackInfo, downloadTrackBuffer, addTrackTags} from 'gerdur-core';

await initDeezerApi(arl);
const track = await getTrackInfo('3135556');
const audio = await downloadTrackBuffer(track, 3);             // fetch + decrypt, retries handled
const {buffer, model} = await addTrackTags(audio!, track, {coverSize: 500});
fs.writeFileSync('out.mp3', buffer);
if (model.lyricsSynced) fs.writeFileSync('out.lrc', model.lyricsSynced);
```

See [README.md](README.md) for the full guide and the
[CHANGELOG](CHANGELOG.md) for the version-by-version history.
