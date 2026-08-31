# gerdur-core

The engine behind [`gerdur`](https://github.com/soulwax/gerdur): the streaming-service API clients, URL resolution, track decryption, and metadata tagging. Also used across the darkfloor / hexmusic services.

Source: <https://github.com/soulwax/gerdur-core> · npm: <https://www.npmjs.com/package/gerdur-core>

## Why *gerdur*?

**Gerðr** is the jötunn Freyr sends his servant Skírnir riding through a wall of fire to fetch; her name, *garðr*, means "the enclosure, the walled garden" (cf. English *garden*). `gerdur-core` does the crossing — resolving identifiers, getting past the wall, decrypting the stream, and handing back a finished, tagged track. The [`gerdur`](https://github.com/soulwax/gerdur) CLI is a thin shell around it.

## Installation

```bash
npm i gerdur-core
```

```bash
yarn add gerdur-core
```

```bash
pnpm add gerdur-core
```

Type declarations are also published under the `gerdur-core/types` subpath for consumers that want to import the shared library types directly.

## Usage

Here's a simple example to download tracks.

```ts
import fs from 'fs';
import {get} from 'https';
import * as api from 'gerdur-core';

const downloadBuffer = (url: string) =>
  new Promise<Buffer>((resolve, reject) => {
    get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });

// Init api with arl from cookie
await api.initDeezerApi(arl_cookie);

// Verify user
try {
  const user = await api.getUser();
  // Successfully logged in
  console.log('Logged in as ' + user.BLOG_NAME);
} catch (err) {
  // Invalid arl cookie set
  console.error(err.message);
}

// GET Track Object
const track = await api.getTrackInfo(song_id);

// Parse download URL for 128kbps
const trackData = await api.getTrackDownloadUrl(track, 1);

// Download track
const data = await downloadBuffer(trackData.trackUrl);

// Decrypt track if needed
const outFile = trackData.isEncrypted ? api.decryptDownload(data, track.SNG_ID) : data;

// Add metadata — resolves album info, credits, lyrics and cover from Deezer
const {buffer, model} = await api.addTrackTags(outFile, track, {coverSize: 500});

// Save file to disk
fs.writeFileSync(track.SNG_TITLE + '.mp3', buffer);

// Time-synced lyrics, when Deezer has them, come back as an LRC document
if (model.lyricsSynced) fs.writeFileSync(track.SNG_TITLE + '.lrc', model.lyricsSynced);
```

### [Read FAQ](docs/faq.md)

## Methods

Every method returns an `Object` or throws. Gateway / media-API failures throw a
**`DeezerError`** (`extends Error`) with:

| Field | |
| :--- | :--- |
| `code` | Deezer's numeric error code, when it sent one (e.g. `4`, `800`) |
| `keys` | the gateway error keys, e.g. `['VALID_TOKEN_REQUIRED']`, `['DATA_ERROR']` |
| `retryable` | whether a retry could plausibly succeed |
| `payload` | the raw error object |

Retries are bounded — `RETRY_POLICY` (exported) sets per-class attempt caps and a
30 s wall-clock deadline, so a persistently failing endpoint surfaces a
`DeezerError` instead of spinning. `GeoBlocked`, `WrongLicense` and
`ExpiredTrackToken` are still thrown as their own types from the download path.

### Sessions

A **`Session`** owns one account's state — the `arl`, the HTTP client (`sid` /
`api_token`), and the account's `license_token` / `country` / streaming rights,
plus the bounded-retry loop and token refresh. This state used to be
module-level globals; bundling it means multiple accounts can coexist.

- **`initDeezerApi(arl)`** — (re)authenticate the **default** session. Every free
  function (`getTrackInfo`, `searchMusic`, `getTrackDownloadUrl`, …) runs against
  it. Unchanged: same signature, returns the gateway `SESSION` id.
- **`createSession(arl?)`** — an **isolated** session you hold and inspect:
  `session.arl`, `session.sid`, and — after `await session.loadUserData()` —
  `session.country`, `session.licenseToken`, `session.canStreamLossless`,
  `session.canStreamHq`. `loadUserData()` caches for 25 min and refreshes on a
  media-API 403.
- **`defaultSession()`** — the `Session` the free functions use.

Each `Session` has **its own response cache** (per-account, since gateway
responses carry account-specific `TRACK_TOKEN`s) and its own query methods:

| Method | |
| :--- | :--- |
| `getUser()` | this account's profile |
| `getTrackInfo(id)` | `song.getData` — the `TRACK_TOKEN` is this session's |
| `getLyrics(id)` | plain + synced lyrics |
| `getAlbumInfo(id)` / `getAlbumTracks(id)` | album metadata / full track list |
| `getPlaylistInfo(id)` / `getPlaylistTracks(id)` | playlist metadata / tracks (with `TRACK_POSITION`) |
| `getArtistInfo(id)` / `getDiscography(id, nb?)` | artist metadata / discography |
| `getProfile(userId)` | a public profile |
| `searchMusic(query, types?, nb?)` | search (`deezer.pageSearch`) |
| `getTrackDownloadUrl(track, quality)` | resolve a CDN URL **as this account** |
| `resolveDownloadUrls(tracks, qualities?)` | batch-resolve, one request, as this account |
| `streamTrack(track, quality, opts?)` | constant-memory stream of decrypted audio |
| `getTrackBuffer(track, quality, opts?)` | download + decrypt fully into a `Buffer` |
| `gw(body, method)` / `gwLight(body, method)` / `gwGet(method, params?)` | the raw coalesced request channels |
| `init(arl?)` / `refreshApiToken()` / `loadUserData(force?)` / `invalidateUserData()` | lifecycle |

The free `getTrackDownloadUrl(track, quality, session?)` / `resolveDownloadUrls(…, session?)`
/ `streamTrackDownload(…, {session})` all take an optional session too;
`downloadTrackBuffer(track, quality, opts?)` is the free-function form of
`session.getTrackBuffer`.

```js
await initDeezerApi(arl);                 // default session, as before
const track = await getTrackInfo('3135556');

const s = await createSession(otherArl);  // a second account, fully isolated
await s.loadUserData();
console.log(s.country, s.canStreamLossless);
const mine = await s.getTrackInfo('3135556');   // runs against `otherArl`
```

### `.initDeezerApi(arl_cookie);`

> It is recommended that you first init the app with this method using your arl cookie.

| Parameters   | Required |     Type |
| ------------ | :------: | -------: |
| `arl_cookie` |   Yes    | `string` |

### `.getTrackInfo(track_id);`

| Parameters | Required |     Type |
| ---------- | :------: | -------: |
| `track_id` |   Yes    | `string` |

### `.getLyrics(track_id);`

| Parameters | Required |     Type |
| ---------- | :------: | -------: |
| `track_id` |   Yes    | `string` |

### `.getAlbumInfo(album_id);`

| Parameters | Required |     Type |
| ---------- | :------: | -------: |
| `album_id` |   Yes    | `string` |

### `.getAlbumTracks(album_id);`

| Parameters | Required |     Type |
| ---------- | :------: | -------: |
| `album_id` |   Yes    | `string` |

### `.getPlaylistInfo(playlist_id);`

| Parameters    | Required |     Type |
| ------------- | :------: | -------: |
| `playlist_id` |   Yes    | `string` |

### `.getPlaylistTracks(playlist_id);`

| Parameters    | Required |     Type |
| ------------- | :------: | -------: |
| `playlist_id` |   Yes    | `string` |

### `.getArtistInfo(artist_id);`

| Parameters  | Required |     Type |
| ----------- | :------: | -------: |
| `artist_id` |   Yes    | `string` |

### `.getDiscography(artist_id, limit);`

| Parameters  | Required |     Type | Default |             Description |
| ----------- | :------: | -------: | ------: | ----------------------: |
| `artist_id` |   Yes    | `string` |       - |               artist id |
| `limit`     |    No    | `number` |     500 | maximum tracks to fetch |

### `.getProfile(user_id);`

| Parameters | Required |     Type |
| ---------- | :------: | -------: |
| `user_id`  |   Yes    | `string` |

### `.searchAlternative(artist_name, song_name);`

| Parameters    | Required |     Type |
| ------------- | :------: | -------: |
| `artist_name` |   Yes    | `string` |
| `song_name`   |   Yes    | `string` |

### `.searchMusic(query, types, limit);`

| Parameters | Required |     Type |   Default |                     Description |
| ---------- | :------: | -------: | --------: | ------------------------------: |
| `query`    |   Yes    | `string` |         - |                    search query |
| `types`    |    No    |  `array` | ['TRACK'] |           array of search types |
| `limit`    |    No    | `number` |        15 | maximum item to fetch per types |

### `.searchPublicApi(query, options?)` — and `.searchTracks` / `.searchAlbums` / `.searchArtists` / `.searchPlaylists`

Hits the **public** REST API (`api.deezer.com/search`) instead of the internal
`pageSearch` gateway. Returns clean public-API objects (`isrc`, `preview`,
`rank`, numeric ids), accepts the advanced query operators, an `order`, and
`limit` / `index` paging. No auth required.

| Parameters       | Required | Type      | Description                                                                   |
| ---------------- | :------: | --------- | --------------------------------------------------------------------------- |
| `query`          | Yes      | `string`  | plain text, or the output of `buildAdvancedQuery`                            |
| `options.type`   | No       | `string`  | `'track'` (default), `'album'`, `'artist'`, `'playlist'`, `'user'`, `'radio'` |
| `options.order`  | No       | `string`  | `RANKING`, `TRACK_ASC`, `RATING_DESC`, `DURATION_DESC`, …                    |
| `options.strict` | No       | `boolean` | send Deezer's `strict=on` (disables the fuzzy fallback)                     |
| `options.limit`  | No       | `number`  | page size (Deezer caps near 100)                                            |
| `options.index`  | No       | `number`  | offset into the result set                                                  |

```js
const {data} = await searchTracks(buildAdvancedQuery({artist: 'daft punk', durMin: 200}), {limit: 25});
```

### `.buildAdvancedQuery(filters)`

Pure helper — composes Deezer's advanced operators into one query string.
`{artist, album, track, label}` become `artist:"…"`; `{durMin, durMax, bpmMin, bpmMax}`
become `dur_min:NNN` / `bpm_min:NNN`; a free-text `query` is emitted first.
Reliable only on the **track** index — `/search/album` and `/search/artist`
ignore the operators, so pass a plain string there.

### `.suggest(query, nb?)`

`deezer.suggest` autocomplete — cheaper and faster than `searchMusic`, for
"as you type" UIs. `nb` (default 5) caps items per type. Needs an initialised
session (`initDeezerApi`).

### Browse & discovery

Public REST endpoints — no `arl` needed, memoised like the rest. All return a
`{data, total?, next?}` list unless noted.

| Method | Returns |
| :--- | :--- |
| `getGenres()` | Deezer's genre list (`id` `0` = "All"). |
| `getChart(genreId = 0, limit = 10)` | `{tracks, albums, artists, playlists, podcasts}` — the ranked lists for a genre. |
| `getChartTracks(genreId = 0, limit = 100, index = 0)` | just the track chart, each with a `position`. |
| `getGenreArtists(genreId)` | artists filed under a genre. |
| `getEditorialList()` | Deezer's editorial sections. |
| `getEditorialReleases(editorialId = 0, limit = 25, index = 0)` | new releases for a section. |
| `getEditorialSelection(editorialId = 0)` | albums the editors are pushing. |
| `getEditorialCharts(editorialId = 0)` | a section's charts (same 5-list shape as `getChart`). |
| `getArtistTopTracks(artistId, limit = 50)` | an artist's most popular tracks. |
| `getRelatedArtists(artistId, limit = 20)` | similar / related artists. |
| `getArtistAlbums(artistId, limit = 50, index = 0)` | the artist's discography. |
| `getArtistPlaylists(artistId, limit = 25)` | playlists featuring the artist. |
| `getArtistRadioTracks(artistId)` | a ready-made radio seeded from the artist. |
| `getTrackByISRC(isrc)` | the public-API track for an ISRC (`bpm`, `gain`, `preview`, …). |
| `getAlbumByUPC(upc)` | the public-API album (with its `tracks`) for a UPC/EAN barcode. |

```js
const {data: genres} = await getGenres();
const rock = genres.find((g) => g.name === 'Rock');
const {tracks} = await getChart(rock.id, 20);            // this week's rock chart
const similar = await getRelatedArtists(27);             // artists like Daft Punk
const track = await getTrackByISRC('USUM71311296');      // "Get Lucky"
```

`getTrackByISRC` / `getAlbumByUPC` return raw public-API objects. To download,
pass the `id` to `getTrackInfo` / `getAlbumTracks` (or use the converter's
`isrc2deezer` / `upc2deezer`, which hydrate a gw track for you).

### Flow, radios & a user's library

Public-profile data — pass a `userId` (`getUser().USER_ID`, a profile URL, or
`parseInfo`). A private library is only visible to that user's own session.

| Method | Returns |
| :--- | :--- |
| `getUserFlow(userId, limit = 40)` | **Flow** — the endless personalised mix, as tracks. |
| `getUserFavoriteTracks(userId, limit?, index?)` | loved tracks, newest first (each with `time_add`). |
| `getUserFavoriteAlbums(userId, limit?, index?)` | favourite albums. |
| `getUserFavoriteArtists(userId, limit?, index?)` | favourite artists. |
| `getUserPlaylists(userId, limit?, index?)` | the user's own + followed playlists. |
| `getUserRadios(userId)` | radios the user favourited. |
| `getUserChartTracks(userId, limit?)` | the user's personal top tracks. |
| `getRadios()` | Deezer's curated radio list. |
| `getRadioTracks(radioId)` | a radio's current tracklist — a ready-to-play source. |
| `getRadioGenres()` | radios grouped by genre. |

```js
const me = await getUser();
const {data: flow} = await getUserFlow(me.USER_ID);       // your Flow
const {data: loved} = await getUserFavoriteTracks(me.USER_ID);
const {data: eighties} = await getRadioTracks(38305);     // "The '80s"
```

### Podcasts

| Method | |
| :--- | :--- |
| `getShowEpisodes(showId, nb = 25, start = 0)` | a page of a show's episodes, newest first |
| `getEpisode(episodeId)` | one episode — `EPISODE_DIRECT_STREAM_URL` is a plain MP3, no licence / decryption |

### `.getTrackDownloadUrl(track, quality);`

| Parameters | Required |        Type |                        Description |
| ---------- | :------: | ----------: | ---------------------------------: |
| `track`    |   Yes    |    `string` |                       track object |
| `quality`  |   Yes    | `1, 3 or 9` | 1 = 128kbps, 3 = 320kbps, 9 = flac |

Resolves `{trackUrl, isEncrypted, fileSize}`. `isEncrypted` now comes from the
media API's `cipher` field (authoritative) rather than a URL guess.

### `.refreshTrackTokens(tracks, options?);`

`TRACK_TOKEN`s live ~1 hour, so a token fetched at the start of a long playlist
download is dead by track 40 (surfacing as an opaque CDN 403). Run the selection
through this first — **one** `song.getListData` request refreshes every token
that has expired (or expires within `options.graceSeconds`, default 300).
Tracks with a still-valid token come back untouched. Also `session.refreshTrackTokens(tracks, graceSeconds?)`.

```js
const fresh = await refreshTrackTokens(playlist.tracks);
const urls = await resolveDownloadUrls(fresh, [9, 3, 1]);
```

### Formats

Deezer's `get_url` understands more than `1 / 3 / 9`. `DEEZER_FORMATS` lists them
best → worst: `FLAC`, `MP3_320`, `MP3_256`, `MP3_128`, `MP3_64`, `AAC_64`,
`MP4_RA3`, `MP4_RA2`, `MP4_RA1` (the last four are the HE-AAC ladder some
accounts / regions expose).

- **`resolveDownloadUrls(tracks, qualities)`** — `qualities` entries may be the
  `1 | 3 | 9` shorthand **or** any format string, e.g.
  `resolveDownloadUrls(tracks, ['FLAC', 'MP3_320', 'AAC_64'])`. Deezer returns
  the best each track is licensed for. Each result now also carries `format` and
  `cipher` (`'BF_CBC_STRIPE'` or `'NONE'`).
- **`formatName(quality)`** / **`toFormat(quality)`** — normalise a number or
  format string to the `get_url` format string.

### `.getTrackPreview(track)` / `.downloadPreview(track)`

The 30-second preview clip — a plain MP3, **no licence, no `arl`, no
encryption**. `track` may be a gw track object (reads its `MEDIA`, no extra
request), a track id, or a number.

```js
const {url} = await getTrackPreview('3135556');      // {url, duration: 30}
const clip = await downloadPreview('3135556');       // Buffer (ID3-tagged MP3)
```

Useful for "audition before download" and for CI that shouldn't pull full tracks.

### `.decryptDownload(data, song_id);`

| Parameters | Required |     Type |            Description |
| ---------- | :------: | -------: | ---------------------: |
| `data`     |   Yes    | `buffer` | downloaded song buffer |
| `song_id`  |   Yes    | `string` |               track id |

### Streaming download

For large files / high concurrency — peak memory is ~one 2048-byte stripe
instead of 2× the file.

- **`streamTrackDownload(track, quality, options?)`** → `{stream, size, startedAt, isEncrypted}`.
  `stream` is decrypted audio bytes (`get_url` → CDN fetch → stripe-decrypt
  `Transform` → your sink). `options.onProgress(received, total)`;
  `options.resumeFrom` (bytes, rounded down to a 2048 boundary) sends a `Range`
  header and resumes stripe-decryption in phase.
- **`createDecryptStream(sngId, startChunk?)`** → a `Transform` for your own `pipeline`.
- **`getStream(url, {rangeStart?})`** → `{stream, headers, status}` — a raw,
  content-decoded response stream.

```js
import {pipeline} from 'stream/promises';
import {createWriteStream} from 'fs';

const {stream} = await streamTrackDownload(track, 9, {
  onProgress: (got, total) => process.stdout.write(`\r${((got / total) * 100) | 0}%`),
});
await pipeline(stream, createWriteStream('track.flac'));
```

Streaming the **tag write** (rewriting the FLAC metadata block in place, no
full-file `Buffer.concat`) is not done yet — buffer the result and call
`addTrackTags`, or tag the file afterward.

### `.addTrackTags(data, track, options?)`

Resolves album info, credits, lyrics and artwork from Deezer and writes them into
the audio (ID3v2.3 for MP3, Vorbis comments for FLAC). Returns
`{buffer, model}` — `model` is the full `TrackTagModel`, including
`model.lyricsSynced` (an LRC document) when the track has time-synced lyrics.

| Parameters | Required |     Type | Description                                    |
| ---------- | :------: | -------: | --------------------------------------------- |
| `data`     |   Yes    | `buffer` | downloaded, decrypted song buffer             |
| `track`    |   Yes    | `object` | track object from `getTrackInfo` / `parseInfo` |
| `options`  |    No    | `object` | `AddTrackTagsOptions` — `coverSize` (56–1800), pre-fetched `album`/`lyrics`/`cover`, and toggles (`richCredits`, `embedArtistImage`, `deezerIds`, …) |

###

> We are not responsible for any misuse of this library by any third party. Please make sure to respect the artists and the music industry when using this library.

> Made with :heart: by the Bluesix Team. If you want to contribute, please read the [contributing guidelines](.github/CONTRIBUTING.md) first.
