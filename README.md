# gerdur-core

> Deezer API client, cross-service URL resolution, Blowfish track decryption and
> MP3/FLAC metadata tagging — the engine behind the [`gerdur`](https://www.npmjs.com/package/gerdur) CLI.

[![npm](https://img.shields.io/npm/v/gerdur-core.svg)](https://www.npmjs.com/package/gerdur-core)
[![npm downloads](https://img.shields.io/npm/dm/gerdur-core.svg)](https://www.npmjs.com/package/gerdur-core)
[![node](https://img.shields.io/node/v/gerdur-core.svg)](https://www.npmjs.com/package/gerdur-core)

`gerdur-core` is a small, dependency-light TypeScript library that does the parts
of a music downloader that are fiddly to get right:

- **Talks to Deezer** — the internal gateway (`gw-light.php` / `gateway.php`), the
  public REST API (`api.deezer.com`) and the media API (`media.deezer.com`), with
  bounded retries, token refresh and per-account sessions.
- **Resolves any link** — Deezer, Spotify, Tidal and YouTube URLs, plus ISRC and
  UPC codes, all mapped to a downloadable Deezer track.
- **Decrypts the stream** — Blowfish-CBC "stripe" decryption, buffered or as a
  Node `Transform` (constant memory, resumable).
- **Writes real tags** — ID3v2.3 for MP3, Vorbis comments for FLAC: cover art,
  full credits, ReplayGain, BPM, ISRC, release dates, plain and time-synced
  lyrics (`.lrc`).
- **Enriches, optionally** — higher-resolution cover art and canonical
  release/label data from MusicBrainz and the Cover Art Archive.

It has **no CLI and does no disk I/O** — every function returns data or a
`Buffer`/stream. The [`gerdur`](https://www.npmjs.com/package/gerdur) package is
the CLI and the file-writing layer on top.

> **Coming from `@soulwax/d-fi-core`?** `gerdur-core` is its continuation — a
> near drop-in rename plus one `addTrackTags` change. See
> **[MIGRATING.md](MIGRATING.md)**.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Guide](#guide)
  - [Authenticate](#authenticate)
  - [Look up tracks, albums, playlists, artists](#look-up-tracks-albums-playlists-artists)
  - [Resolve a share URL (Deezer / Spotify / Tidal / YouTube)](#resolve-a-share-url)
  - [Resolve an ISRC or UPC](#resolve-an-isrc-or-upc)
  - [Search](#search)
  - [Browse and discover](#browse-and-discover)
  - [Flow, radios and a user's library](#flow-radios-and-a-users-library)
  - [Podcasts](#podcasts)
  - [Preview clips](#preview-clips)
  - [Resolve a download URL](#resolve-a-download-url)
  - [Download a track (buffer)](#download-a-track-buffer)
  - [Download a track (stream, constant memory, resume)](#download-a-track-stream)
  - [Decrypt](#decrypt)
  - [Tag MP3 / FLAC](#tag-mp3--flac)
  - [Enrichment (MusicBrainz + Cover Art Archive)](#enrichment)
  - [Use multiple accounts](#use-multiple-accounts)
  - [HTTP helpers](#http-helpers)
- [Errors](#errors)
- [Types](#types)
- [API reference](#api-reference)
- [Migrating from @soulwax/d-fi-core](#migrating)
- [The name](#the-name)
- [Legal](#legal)

---

## Install

```bash
npm i gerdur-core
```

```bash
yarn add gerdur-core
```

```bash
pnpm add gerdur-core
```

- **Node** ≥ 12. Ships CommonJS (`dist/`) with bundled `.d.ts`.
- **Types subpath**: the hand-written Deezer response types are also published at
  `gerdur-core/types`, so downstream packages can `import type {trackType} from
  'gerdur-core/types'` without a second dependency.
- You need a Deezer **`arl`** cookie for anything account-scoped (downloads,
  `getUser`, lyrics, the internal search). Public REST endpoints (charts, public
  search, ISRC/UPC lookups, previews) work with no auth.

## Quick start

Download one track, tag it, and write it to disk:

```ts
import {writeFileSync} from 'fs';
import {initDeezerApi, getTrackInfo, downloadTrackBuffer, addTrackTags} from 'gerdur-core';

await initDeezerApi(process.env.ARL!); // 192-char arl cookie

const track = await getTrackInfo('3135556'); // Daft Punk — Harder, Better, Faster, Stronger
const audio = await downloadTrackBuffer(track, 3); // 3 = 320 kbps MP3, downloaded + decrypted
if (!audio) throw new Error('not available for this account / region');

const {buffer, model} = await addTrackTags(audio, track); // cover, credits, lyrics, ReplayGain…
writeFileSync(`${model.title}.mp3`, buffer);
if (model.lyricsSynced) writeFileSync(`${model.title}.lrc`, model.lyricsSynced); // synced lyrics
```

The same pipeline, one step at a time — resolve a URL, then run each track
through it yourself:

```ts
import {writeFileSync} from 'fs';
import {
  initDeezerApi,
  parseInfo,
  resolveDownloadUrls,
  refreshTrackTokens,
  getBuffer,
  decryptDownload,
  addTrackTags,
} from 'gerdur-core';

await initDeezerApi(process.env.ARL!);

const {tracks} = await parseInfo('https://www.deezer.com/album/302127');
const fresh = await refreshTrackTokens(tracks); // long lists: refresh expiring tokens first
const urls = await resolveDownloadUrls(fresh, ['FLAC', 'MP3_320', 'MP3_128']); // one request

for (const [i, track] of fresh.entries()) {
  const url = urls[i];
  if (!url) continue; // geo-blocked / unavailable
  const body = await getBuffer(url.trackUrl);
  const decrypted = url.isEncrypted ? decryptDownload(body, track.SNG_ID) : body;
  const {buffer, model} = await addTrackTags(decrypted, track);
  writeFileSync(`${model.trackNumber}. ${model.title}.${url.format === 'FLAC' ? 'flac' : 'mp3'}`, buffer);
}
```

## Core concepts

**`arl` cookie.** Deezer authenticates the mobile/gateway API with a single
`arl` cookie (192 characters). `initDeezerApi(arl)` exchanges it for a session
token. Get one from a logged-in browser: DevTools → Application → Cookies →
`deezer.com` → `arl` (see the [FAQ](docs/faq.md)).

**Sessions.** A [`Session`](#use-multiple-accounts) owns one account's state —
the `arl`, the HTTP client (session id / API token), the media `license_token`,
the resolved `country` and streaming rights, plus the retry loop and a response
cache. The free functions (`getTrackInfo`, `searchMusic`, …) run against a
process-wide **default** session that `initDeezerApi` configures. Call
`createSession(arl)` for an isolated one.

**Quality.** Numeric shorthand: **`1`** = MP3 128 kbps, **`3`** = MP3 320 kbps,
**`9`** = FLAC (~1411 kbps). The batch resolver also takes format strings from
[`DEEZER_FORMATS`](#resolve-a-download-url) (`FLAC`, `MP3_320`, `MP3_256`,
`MP3_128`, `MP3_64`, `AAC_64`, `MP4_RA3/2/1`). What you actually get depends on
the account's plan and the track's licensing.

**Track tokens.** Each track carries a `TRACK_TOKEN` that the media API needs; it
lives ~1 hour. A token fetched at the start of a long download is stale by track
40 and surfaces as an opaque CDN 403 — run the list through
[`refreshTrackTokens`](#resolve-a-download-url) first.

**Encryption.** Most CDN downloads are Blowfish-CBC "stripe"-obfuscated: the file
is split into 2048-byte chunks and only every third one (0, 3, 6, …) is
encrypted. `resolved.isEncrypted` (from the media API's `cipher` field) tells you
whether to [decrypt](#decrypt). Previews and podcast episodes are plain.

**Retries.** Gateway calls run through a bounded loop — per-error-class attempt
caps plus a 30 s wall-clock deadline, full-jittered exponential backoff. A
persistently failing endpoint throws a [`DeezerError`](#errors) instead of
spinning. The policy is exported as `RETRY_POLICY`.

---

## Guide

### Authenticate

```ts
import {initDeezerApi, getUser} from 'gerdur-core';

await initDeezerApi(arl); // throws if arl length !== 192; returns the gateway SESSION id

try {
  const me = await getUser();
  console.log('Logged in as', me.BLOG_NAME, '· id', me.USER_ID, '· country', me.COUNTRY);
} catch (err) {
  console.error('arl invalid or expired:', (err as Error).message);
}
```

`initDeezerApi` only pings for a session token. The `license_token`, `country`
and streaming rights are fetched lazily on the first download (or eagerly with
`createSession(arl)` + `await session.loadUserData()`).

### Look up tracks, albums, playlists, artists

All take string ids and return the raw Deezer gateway objects. Every response is
memoised (LRU, 1000 entries / 60 min) and in-flight-coalesced.

| Function | Returns |
| :--- | :--- |
| `getTrackInfo(id)` | `song.getData` — the track, with this session's `TRACK_TOKEN` |
| `getLyrics(id)` | `song.getLyrics` — `LYRICS_TEXT` plus `LYRICS_SYNC_JSON` when synced |
| `getAlbumInfo(id)` | `album.getData` |
| `getAlbumTracks(id)` | every track on the album (`song.getListByAlbum`, `nb: -1`) |
| `getPlaylistInfo(id)` | `playlist.getData` |
| `getPlaylistTracks(id)` | every track, with `TRACK_POSITION` filled in |
| `getArtistInfo(id)` | `artist.getData` |
| `getDiscography(id, nb = 500)` | the artist's discography (`album.getDiscography`) |
| `getProfile(userId)` | a public profile (`mobile.pageUser`, loved tracks) |
| `getShowInfo(showId, nb?, start?)` | a podcast show + a page of `EPISODES` |
| `getChannelList()` | Deezer's browse channels |
| `getPlaylistChannel(page)` | a channel page (`app_page_get`) — e.g. `"channels/dance"` |
| `getUser()` | the logged-in account's profile |
| `getTrackInfoPublicApi(id)` / `getAlbumInfoPublicApi(id)` | the same entities from the **public** REST API (`isrc`, `bpm`, `contributors`) |

```ts
const album = await getAlbumInfo('302127');
const {data: tracks} = await getAlbumTracks('302127');
console.log(album.ALB_TITLE, '—', tracks.length, 'tracks');
```

### Resolve a share URL

`parseInfo(url)` classifies a Deezer / Spotify / Tidal / YouTube URL, fetches it,
and returns a uniform shape. Spotify/Tidal/YouTube entities are matched to their
Deezer equivalents (ISRC for tracks, UPC for albums), so everything downstream is
a Deezer track.

```ts
import {parseInfo, getUrlParts} from 'gerdur-core';

const {info, linktype, linkinfo, tracks} = await parseInfo(
  'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc',
);
// info      → {type: 'spotify-album', id: '2noRn2Aes5aoNVsU6iWThc'}
// linktype  → 'album' | 'playlist' | 'artist' | 'track'
// linkinfo  → the album/playlist/artist object (empty for a single track)
// tracks    → trackType[] ready for resolveDownloadUrls

const parts = await getUrlParts('https://deezer.com/track/3135556'); // just classify: {type, id}
```

Supported: Deezer `track` / `album` / `audiobook` / `playlist` / `artist` (+
`page.link` short links), `spotify:` URIs and `open.spotify.com` links, Tidal
links, and `youtube.com/watch` / `youtu.be` links. Spotify artist resolution is
capped at ~10 tracks by Spotify's anonymous token.

The lower-level converters are also exported:

```ts
import {isrc2deezer, upc2deezer, spotify, tidal, youtube} from 'gerdur-core';

const track = await isrc2deezer('Get Lucky', 'USUM71311296'); // hydrated gw track
const [albumInfo, albumTracks] = await upc2deezer('Discovery', '0724384960650');
await spotify.setSpotifyAnonymousToken(); // needed before spotify.* calls
```

### Resolve an ISRC or UPC

Public REST, no auth. Returns public-API objects (not gw tracks — pass `.id` to
`getTrackInfo` / `getAlbumTracks` to make them downloadable).

```ts
import {getTrackByISRC, getAlbumByUPC, getTrackInfo} from 'gerdur-core';

const pub = await getTrackByISRC('USUM71311296'); // {id, title, bpm, gain, isrc, preview, …}
const track = await getTrackInfo(String(pub.id)); // now downloadable

const album = await getAlbumByUPC('0724384960650'); // {id, title, tracks: {data: [...]}}
```

### Search

**Internal search** — `deezer.pageSearch`, needs a session. Richest results
(top-result ranking, artist suggestions), and it returns per-type totals.

```ts
import {searchMusic, searchFacets, suggest} from 'gerdur-core';

const result = await searchMusic('daft punk', ['TRACK', 'ALBUM', 'ARTIST'], 25);
result.TRACK.data.forEach((t) => console.log(t.SNG_TITLE, '—', t.ART_NAME));

searchFacets(result); // {track: 207, album: 99, artist: 17, …, order: ['TOP_RESULT','ARTIST','TRACK',…]}

const hints = await suggest('daf'); // fast "as you type" autocomplete, per-type
```

**Public REST search** — `api.deezer.com/search`, no auth. Clean objects with
`isrc` / `preview` / `rank`, `order`, and `limit` / `index` paging.

```ts
import {
  searchPublicApi,
  searchTracks,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  buildAdvancedQuery,
} from 'gerdur-core';

const {data} = await searchTracks('one more time', {order: 'RANKING', limit: 25});

// advanced operators — reliable only on the track index
const q = buildAdvancedQuery({artist: 'daft punk', durMin: 200, bpmMax: 130});
// => 'artist:"daft punk" dur_min:200 bpm_max:130'
const strict = await searchPublicApi(q, {strict: true, limit: 50});

const albums = await searchAlbums('discovery'); // plain string — operators are ignored here
```

| `searchPublicApi(query, options)` option | Type | Notes |
| :--- | :--- | :--- |
| `type` | `'track'` (default) `'album'` `'artist'` `'playlist'` `'user'` `'radio'` `'podcast'` | |
| `order` | `RANKING`, `RATING_DESC`, `DURATION_DESC`, `TRACK_ASC`, … | |
| `strict` | `boolean` | send `strict=on` — disables Deezer's fuzzy fallback |
| `limit` / `index` | `number` | page size (Deezer caps near 100) / offset |

`buildAdvancedQuery({query?, artist?, album?, track?, label?, durMin?, durMax?, bpmMin?, bpmMax?})`
is a pure string builder — Deezer treats the operators as ranking hints, not hard
filters, and only honours them on **track** search.

### Browse and discover

Public REST, no auth. Everything returns a `{data, total?, next?}` list unless
noted.

| Function | Returns |
| :--- | :--- |
| `getGenres()` | Deezer's genre list (`id` `0` = "All") |
| `getChart(genreId = 0, limit = 10)` | `{tracks, albums, artists, playlists, podcasts}` for a genre |
| `getChartTracks(genreId = 0, limit = 100, index = 0)` | just the track chart, each with a `position` |
| `getGenreArtists(genreId)` | artists filed under a genre |
| `getEditorialList()` | Deezer's editorial sections |
| `getEditorialReleases(id = 0, limit = 25, index = 0)` | new releases for a section |
| `getEditorialSelection(id = 0)` | albums the editors are pushing |
| `getEditorialCharts(id = 0)` | a section's charts (same 5-list shape as `getChart`) |
| `getArtistTopTracks(artistId, limit = 50)` | an artist's most popular tracks |
| `getRelatedArtists(artistId, limit = 20)` | similar artists |
| `getArtistAlbums(artistId, limit = 50, index = 0)` | the artist's discography (public shape) |
| `getArtistPlaylists(artistId, limit = 25)` | playlists featuring the artist |
| `getArtistRadioTracks(artistId)` | a ready-made radio seeded from the artist |

```ts
import {getGenres, getChart, getRelatedArtists} from 'gerdur-core';

const {data: genres} = await getGenres();
const rock = genres.find((g) => g.name === 'Rock')!;
const {tracks} = await getChart(rock.id, 20); // this week's rock chart
const similar = await getRelatedArtists(27); // artists like Daft Punk
```

### Flow, radios and a user's library

Public-profile data — pass a `userId` (`getUser().USER_ID`, a profile URL, or
`parseInfo`). A **private** library is only visible to that user's own session.

| Function | Returns |
| :--- | :--- |
| `getUserFlow(userId, limit = 40)` | **Flow** — the endless personalised mix, as tracks |
| `getUserFavoriteTracks(userId, limit?, index?)` | loved tracks, newest first (each with `time_add`) |
| `getUserFavoriteAlbums(userId, limit?, index?)` | favourite albums |
| `getUserFavoriteArtists(userId, limit?, index?)` | favourite artists |
| `getUserPlaylists(userId, limit?, index?)` | the user's own + followed playlists |
| `getUserRadios(userId)` | radios the user favourited |
| `getUserChartTracks(userId, limit?)` | the user's personal top tracks |
| `getRadios()` | Deezer's curated radio list |
| `getRadioTracks(radioId)` | a radio's current tracklist — a ready-to-play source |
| `getRadioGenres()` | radios grouped by genre |

```ts
import {getUser, getUserFlow, getUserFavoriteTracks, getRadioTracks} from 'gerdur-core';

const me = await getUser();
const {data: flow} = await getUserFlow(me.USER_ID);
const {data: loved} = await getUserFavoriteTracks(me.USER_ID);
const {data: eighties} = await getRadioTracks(38305); // "The '80s"
```

### Podcasts

```ts
import {getShowEpisodes, getEpisode} from 'gerdur-core';

const {data: episodes} = await getShowEpisodes('1265876', 25); // newest first
const ep = await getEpisode(episodes[0].EPISODE_ID);
// ep.EPISODE_DIRECT_STREAM_URL — a plain MP3: no licence, no decryption
```

### Preview clips

The 30-second preview is a plain MP3 — **no licence, no `arl`, no encryption**.
Good for "audition before download" and for CI that must not pull full tracks.

```ts
import {getTrackPreview, downloadPreview} from 'gerdur-core';

const {url, duration} = (await getTrackPreview('3135556'))!; // {url, duration: 30}
const clip = await downloadPreview('3135556'); // Buffer (plain MP3), or null
```

Accepts a gw `track` object (reads its `MEDIA`, no extra request), a track id, or
a number.

### Resolve a download URL

```ts
import {getTrackDownloadUrl, resolveDownloadUrls, refreshTrackTokens, DEEZER_FORMATS} from 'gerdur-core';

// one track
const one = await getTrackDownloadUrl(track, 9); // {trackUrl, isEncrypted, fileSize} | null

// many tracks, ONE request — Deezer returns the best each is licensed for
const fresh = await refreshTrackTokens(tracks); // refresh tokens older than ~1h first
const urls = await resolveDownloadUrls(fresh, ['FLAC', 'MP3_320', 'MP3_128']);
// urls[i] → {trackUrl, isEncrypted, fileSize, format, cipher} | null
```

- **`DEEZER_FORMATS`** (best → worst): `FLAC`, `MP3_320`, `MP3_256`, `MP3_128`,
  `MP3_64`, `AAC_64`, `MP4_RA3`, `MP4_RA2`, `MP4_RA1`. `resolveDownloadUrls`
  accepts either these strings or the `1 | 3 | 9` shorthand.
- **`formatName(q)` / `toFormat(q)`** — normalise a number or string to the media
  API's format string.
- **`refreshTrackTokens(tracks, {graceSeconds = 300, session?})`** — one
  `song.getListData` request refreshes every token that has expired or expires
  within `graceSeconds`. Tracks with a valid token are returned untouched.
- Falls back to the legacy `e-cdns-proxy-*.dzcdn.net` scheme when the media API
  declines. Throws [`WrongLicense`](#errors) / [`GeoBlocked`](#errors) /
  [`ExpiredTrackToken`](#errors).

### Download a track (buffer)

```ts
import {downloadTrackBuffer, addTrackTags} from 'gerdur-core';

const audio = await downloadTrackBuffer(track, 3); // get_url → fetch → decrypt, all in memory
if (audio) {
  const {buffer} = await addTrackTags(audio, track);
  // buffer is a tagged MP3/FLAC — write it wherever
}
```

`downloadTrackBuffer(track, quality, {onProgress?, session?})` → `Buffer | null`
(`null` when the track+quality can't be resolved). No resume — use the stream API
for that.

### Download a track (stream)

Constant memory (~one 2048-byte stripe) regardless of file size or concurrency,
with progress and resume.

```ts
import {pipeline} from 'stream/promises';
import {createWriteStream, statSync, existsSync} from 'fs';
import {streamTrackDownload} from 'gerdur-core';

const resumeFrom = existsSync('track.flac') ? statSync('track.flac').size : 0;

const {stream, size, startedAt, isEncrypted} = await streamTrackDownload(track, 9, {
  resumeFrom, // rounded down to a 2048-byte boundary so stripe decryption stays aligned
  onProgress: (received, total) => process.stdout.write(`\r${((received / total) * 100) | 0}%`),
});

await pipeline(stream, createWriteStream('track.flac', {flags: startedAt > 0 ? 'a' : 'w'}));
```

Lower-level pieces:

- **`getStream(url, {rangeStart?})`** → `{stream, headers, status, url}` — a raw,
  content-decoded (gzip/br/deflate) response stream.
- **`createDecryptStream(sngId, startChunk?)`** → a Node `Transform` for your own
  `pipeline`. `startChunk` = `resumeFromByte / 2048`.
- **`TrackDecryptStream(sngId, startChunk?)`** — the imperative engine
  (`.write(buf) → Buffer`, `.final() → Buffer`) behind that `Transform`.

> Streaming the **tag write** (rewriting a FLAC metadata block with no full-file
> buffer) is not implemented yet — buffer the stream and call `addTrackTags`, or
> tag the finished file afterwards.

### Decrypt

```ts
import {decryptDownload} from 'gerdur-core';

const plain = resolved.isEncrypted ? decryptDownload(body, track.SNG_ID) : body;
```

`decryptDownload(buffer, sngId)` decrypts a fully-downloaded body. Format-
preserving: an encrypted MP3 stays an MP3. The per-track key is
`md5(sngId)[i] ^ md5(sngId)[i+16] ^ "g4el58wc0zvf9na1"[i]`.

`getSongFileName(track, quality)` builds the obfuscated filename for the legacy
CDN path — you rarely need it directly.

### Tag MP3 / FLAC

`addTrackTags(buffer, track, options?)` sniffs `fLaC` vs MP3, gathers everything
Deezer has for the track (album info, credits, lyrics, cover, artist photo,
BPM — all coalesced, so tagging a whole album hits each endpoint once), writes
the tags, and returns `{buffer, model}`.

```ts
const {buffer, model} = await addTrackTags(audio, track, {
  coverSize: 1200, // 56–1800 px, default 1000
});

model.title;         // "Harder, Better, Faster, Stronger"
model.isrc;          // "GBDUW0000059"
model.bpm;           // 123
model.replayGainTrackGain; // "-9.24 dB"
model.lyricsSynced;  // an LRC document — write it as a .lrc sidecar
model.contributors;  // normalised producers / engineers / performers / …
```

| `AddTrackTagsOptions` | Default | |
| :--- | :--- | :--- |
| `coverSize` | `1000` | embedded cover width, 56–1800 px |
| `cover` / `artistImage` | — | pre-fetched image `Buffer` (`null` = skip); avoids a download |
| `album` / `lyrics` / `publicTrack` | — | pre-fetched payloads — pass once per album to skip refetching |
| `embedCover` / `embedArtistImage` | `true` | |
| `writeLyrics` / `embedSyncedLyrics` | `true` | synced LRC goes to FLAC Vorbis only (no ID3v2.3 `SYLT`) |
| `richCredits` | `true` | hydrate credits + BPM for album/playlist tracks that omit them |
| `deezerIds` / `includeRank` | `true` | write `DEEZER_*_ID` / popularity rank |

Building blocks, if you want the model without writing tags:

- **`getRichAlbum(albId)`** → merged gw + public album metadata (`RichAlbum`).
- **`buildTagModel(input)`** → the canonical `TrackTagModel` (see [Types](#types)).
- **`normalizeContributors(SNG_CONTRIBUTORS)`** → cleans Deezer's messy
  contributor keys into `{mainArtists, featuring, composers, producers,
  engineers, …}`.
- **`toLrc(syncJson, meta)`** → render `LYRICS_SYNC_JSON` as an LRC string.
- **`downloadAlbumCover(track, size)` / `downloadArtistImage(track)`** →
  image `Buffer`s. `MAX_COVER_SIZE` = 1800.

### Enrichment

Optional, **read-only**, off by default, and **never wired into `addTrackTags`**.
Fills gaps Deezer leaves — canonical release/label data and cover art larger than
Deezer's 1800 px ceiling.

```ts
import {configureMusicBrainz, getCoverArtByISRC, lookupRecordingByISRC} from 'gerdur-core';

configureMusicBrainz({userAgent: 'my-app/1.0 ( me@example.com )'}); // required — MB wants a real UA

// one call: ISRC → MusicBrainz recording → best Cover Art Archive front cover
const coverUrl = await getCoverArtByISRC(track.ISRC, {minSize: 1200}); // string | null
if (coverUrl) {
  const cover = await getBuffer(coverUrl);
  await addTrackTags(audio, track, {cover}); // hand it your own cover
}

// or the pieces
const rec = await lookupRecordingByISRC(track.ISRC); // MBRecording | null
rec?.isrcs;    // every ISRC MB has for this recording
rec?.releases; // each with releaseGroupMbid, primaryType, status, label, catalogNumber
```

| Function | |
| :--- | :--- |
| `configureMusicBrainz({userAgent?, minIntervalMs?})` | set the UA and rate limit (default 1100 ms); call once at startup |
| `lookupRecordingByISRC(isrc)` | canonical `MBRecording` (title, artist credits, length, ISRCs, releases) or `null` |
| `getMusicBrainzRecording(mbid)` / `getMusicBrainzRelease(mbid, inc?)` | direct MBID lookups; release adds label / catalogue number / barcode |
| `getCoverArt(mbid, entity = 'release-group')` | Cover Art Archive images (`front` / `approved` / `thumbnails`), or `null` |
| `getBestCoverArtUrl(mbid, {entity?, minSize = 1200})` | one URL — approved front cover ≥ `minSize` px, else full-res |
| `getRecordingCoverArt(recording, {minSize?, maxTries = 4})` | walks a recording's release-groups canonical-first (Official → Album → earliest) |
| `getCoverArtByISRC(isrc, {minSize?, maxTries?})` | the whole chain — **use this**, not `getBestCoverArtUrl` on `releases[0]` |
| `PoliteJsonClient` | the serialised, rate-limited, `503`/`429`-retrying, `404`→`null` JSON client both use — exported for your own polite clients |

A persistent MusicBrainz `503` ("server busy") surfaces as `HttpStatusError`
after 3 backed-off retries — catch it and fall back to Deezer's data.

### Use multiple accounts

The free functions share one default session. For concurrent accounts, hold
isolated `Session` objects — each with its own `arl`, tokens, `license_token`
and response cache.

```ts
import {createSession} from 'gerdur-core';

const a = await createSession(arlOne);
const b = await createSession(arlTwo);

await a.loadUserData();
console.log(a.country, a.canStreamLossless, a.licenseToken);

const track = await a.getTrackInfo('3135556'); // TRACK_TOKEN is a's
const audio = await a.getTrackBuffer(track, 9); // resolved + decrypted as account a
```

`Session` methods: `getUser`, `getTrackInfo`, `getLyrics`, `getAlbumInfo`,
`getAlbumTracks`, `getPlaylistInfo`, `getPlaylistTracks`, `getArtistInfo`,
`getDiscography`, `getProfile`, `searchMusic`, `getTrackDownloadUrl`,
`resolveDownloadUrls`, `refreshTrackTokens`, `streamTrack`, `getTrackBuffer`,
plus lifecycle (`init`, `refreshApiToken`, `loadUserData`, `invalidateUserData`)
and the raw channels (`gw`, `gwLight`, `gwGet`).

`defaultSession()` returns the shared one; `setDefaultSession(s)` swaps it (used
in tests). The free `getTrackDownloadUrl` / `resolveDownloadUrls` /
`streamTrackDownload` / `refreshTrackTokens` all take an optional `session`.

### HTTP helpers

The zero-dependency HTTP client (`get`/`post`/`head`, redirects, gzip/br/deflate,
keep-alive) is used internally and exported for reuse:

```ts
import {getJson, getText, getBuffer, getStream, httpAgent, httpsAgent, HttpClient} from 'gerdur-core';

const data = await getJson<{id: number}>('https://api.deezer.com/track/3135556');
const bytes = await getBuffer(coverUrl);
const {stream} = await getStream(bigFileUrl, {rangeStart: 1024});

const client = new HttpClient({baseURL: 'https://api.deezer.com', timeout: 15000});
```

`httpAgent` / `httpsAgent` are shared keep-alive agents — pass them to your own
`http` calls to reuse connections.

---

## Errors

Gateway and media-API failures throw a **`DeezerError`** (`extends Error`):

| Field | |
| :--- | :--- |
| `code` | Deezer's numeric code, when it sent one (e.g. `4`, `800`) |
| `keys` | gateway error keys, e.g. `['VALID_TOKEN_REQUIRED']`, `['DATA_ERROR']` |
| `retryable` | whether a retry could plausibly help |
| `payload` | the raw error object |

The download path also throws these typed errors:

| Error | Meaning | Recovery |
| :--- | :--- | :--- |
| `GeoBlocked` | not licensed in the account's country | try another account / region |
| `WrongLicense` | the account's plan can't stream that format | request a lower quality |
| `ExpiredTrackToken` | the `TRACK_TOKEN` aged out (~1 h) | re-fetch the track (`getTrackInfo`) or `refreshTrackTokens`, then retry |
| `HttpStatusError` | a non-2xx HTTP response (`statusCode`, `headers`, `body`) | inspect `statusCode` |

`RETRY_POLICY` (exported) is the bounded-retry config: `code4Attempts`,
`authReinits`, `tokenRefreshes`, `baseMs`, `maxDelayMs`, `deadlineMs`.

## Types

Response types are hand-written and shipped both from the main entry and the
`gerdur-core/types` subpath:

```ts
import type {trackType, albumType, playlistTracksType, lyricsType} from 'gerdur-core/types';
import type {
  TrackTagModel, // canonical tag model from addTrackTags / buildTagModel
  RichAlbum,
  ResolvedUrl, // {trackUrl, isEncrypted, fileSize, format, cipher}
  TrackStream, // {stream, size, startedAt, isEncrypted}
  StreamTrackOptions,
  SessionUserData, // {licenseToken, country, canStreamLossless, canStreamHq, offerId?}
  DeezerFormat,
  AddTrackTagsOptions,
  MBRecording,
  MBRelease,
  CoverArt,
} from 'gerdur-core';
```

`TrackTagModel` is the normalised view every tag writer consumes — `title`,
`artists` / `mainArtists` / `featuredArtists`, `composers` / `producers` /
`engineers` / `performers`, `trackNumber` / `discNumber` / totals, `isrc` /
`barcode` / `bpm` / `durationMs`, `genres` / `label` / `releaseType`, `date` /
`originalDate`, `copyright` / `producerLine`, `replayGainTrackGain`, `explicit`,
`lyrics` / `lyricsSynced`, `ids.*` and `rank`.

## API reference

<details>
<summary><b>Auth &amp; sessions</b></summary>

`initDeezerApi(arl)` · `createSession(arl?)` · `defaultSession()` ·
`setDefaultSession(s)` · `Session` · `RETRY_POLICY` · `DEFAULT_ARL`
</details>

<details>
<summary><b>Lookups</b></summary>

`getTrackInfo` · `getLyrics` · `getAlbumInfo` · `getAlbumTracks` ·
`getPlaylistInfo` · `getPlaylistTracks` · `getArtistInfo` · `getDiscography` ·
`getProfile` · `getUser` · `getShowInfo` · `getChannelList` ·
`getPlaylistChannel` · `getTrackInfoPublicApi` · `getAlbumInfoPublicApi`
</details>

<details>
<summary><b>URL &amp; code resolution</b></summary>

`parseInfo` · `getUrlParts` · `isrc2deezer` · `upc2deezer` ·
`getTrackByISRC` · `getAlbumByUPC` · `spotify.*` · `tidal.*` · `youtube.*`
</details>

<details>
<summary><b>Search</b></summary>

`searchMusic` · `searchAlternative` · `suggest` · `searchFacets` ·
`searchPublicApi` · `searchTracks` · `searchAlbums` · `searchArtists` ·
`searchPlaylists` · `buildAdvancedQuery`
</details>

<details>
<summary><b>Browse &amp; discovery</b></summary>

`getGenres` · `getGenreArtists` · `getChart` · `getChartTracks` ·
`getEditorialList` · `getEditorialReleases` · `getEditorialSelection` ·
`getEditorialCharts` · `getArtistTopTracks` · `getRelatedArtists` ·
`getArtistAlbums` · `getArtistPlaylists` · `getArtistRadioTracks`
</details>

<details>
<summary><b>Flow, radios, library</b></summary>

`getUserFlow` · `getUserFavoriteTracks` · `getUserFavoriteAlbums` ·
`getUserFavoriteArtists` · `getUserPlaylists` · `getUserRadios` ·
`getUserChartTracks` · `getRadios` · `getRadioTracks` · `getRadioGenres`
</details>

<details>
<summary><b>Podcasts &amp; previews</b></summary>

`getEpisode` · `getShowEpisodes` · `getTrackPreview` · `downloadPreview`
</details>

<details>
<summary><b>Download, decrypt, stream</b></summary>

`getTrackDownloadUrl` · `resolveDownloadUrls` · `refreshTrackTokens` ·
`downloadTrackBuffer` · `streamTrackDownload` · `getStream` ·
`createDecryptStream` · `TrackDecryptStream` · `decryptDownload` ·
`getSongFileName` · `DEEZER_FORMATS` · `formatName` · `toFormat`
</details>

<details>
<summary><b>Tagging</b></summary>

`addTrackTags` · `buildTagModel` · `getRichAlbum` · `normalizeContributors` ·
`toLrc` · `downloadAlbumCover` · `downloadArtistImage` · `MAX_COVER_SIZE`
</details>

<details>
<summary><b>Enrichment</b></summary>

`configureMusicBrainz` · `lookupRecordingByISRC` · `getMusicBrainzRecording` ·
`getMusicBrainzRelease` · `getCoverArt` · `getBestCoverArtUrl` ·
`getRecordingCoverArt` · `getCoverArtByISRC` · `PoliteJsonClient`
</details>

<details>
<summary><b>HTTP &amp; errors</b></summary>

`getJson` · `getText` · `getBuffer` · `getStream` · `HttpClient` · `httpAgent` ·
`httpsAgent` · `HttpStatusError` · `DeezerError` · `GeoBlocked` · `WrongLicense`
· `ExpiredTrackToken`
</details>

See the [FAQ](docs/faq.md) and the [`gerdur` CLI](https://www.npmjs.com/package/gerdur)
for end-to-end usage.

<a id="migrating"></a>

## Migrating from @soulwax/d-fi-core

`gerdur-core` is the continuation of `@soulwax/d-fi-core`. `gerdur-core@1.0.1` is
that codebase renamed; everything since is additive except a single `addTrackTags`
signature change. **[MIGRATING.md](MIGRATING.md)** has the exact steps —
dependency swap, import rename, the one fix, the workarounds you can now delete,
and the faster primitives (`downloadTrackBuffer`, batch `resolveDownloadUrls`,
`streamTrackDownload`, `Session`, `DeezerError`) to adopt.

## The name

**Gerðr** is the jötunn Freyr sends Skírnir riding through a wall of fire to
fetch. Her name is *garðr* — "the enclosure, the walled garden" (English
*garden*). `gerdur-core` does the crossing: resolve the identifier, get past the
wall, decrypt the stream, hand back a finished track.

## Legal

For personal and archival use with content you are entitled to access. You are
responsible for complying with the terms of service of any provider and with
copyright law in your jurisdiction. The authors accept no liability for misuse.
Respect the artists — buy the music you love.

See [LICENSE](LICENSE) · [Contributing](.github/CONTRIBUTING.md) ·
[Issues](https://github.com/soulwax/gerdur-core/issues)
