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

All method returns `Object` or throws `Error`. Make sure to catch error on your side.

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

### `.getTrackDownloadUrl(track, quality);`

| Parameters | Required |        Type |                        Description |
| ---------- | :------: | ----------: | ---------------------------------: |
| `track`    |   Yes    |    `string` |                       track object |
| `quality`  |   Yes    | `1, 3 or 9` | 1 = 128kbps, 3 = 320kbps, 9 = flac |

### `.decryptDownload(data, song_id);`

| Parameters | Required |     Type |            Description |
| ---------- | :------: | -------: | ---------------------: |
| `data`     |   Yes    | `buffer` | downloaded song buffer |
| `song_id`  |   Yes    | `string` |               track id |

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
