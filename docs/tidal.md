# Tidal to Deezer

`gerdur-core` exports Tidal api to easily convert tracks, albums, artists and playlist to deezer via matching ISRC and UPC code.

## Usage

Here's a simple example. All method returns `Object` or throws `Error`. Make sure to catch error on your side.

```ts
import {tidal} from 'gerdur-core';

// Convert single track to deezer
const track = await tidal.track2deezer(song_id);
console.log(track);

// Convert album and tracks to deezer
const [album, tracks] = await tidal.album2deezer(album_id);
console.log(album);
console.log(tracks);

// Convert playlist and tracks to deezer
const [playlist, tracks] = await tidal.playlist2Deezer(playlist_id);
console.log(playlist);
console.log(tracks);

// Convert artist tracks to deezer (limited to 10 tracks)
const tracks = await tidal.artist2Deezer(artist_id);
console.log(tracks);
```
