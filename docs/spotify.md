# Spotify to Deezer

`gerdur-core` exports Spotify api to easily convert tracks, albums, artists and playlist to deezer via matching ISRC and UPC code.

## Usage

Here's a simple example. All method returns `Object` or throws `Error`. Make sure to catch error on your side.

```ts
import {spotify} from 'gerdur-core';

// Set token first to bypass some limits
await spotify.setSpotifyAnonymousToken();

// Convert single track to deezer
const track = await spotify.track2deezer(song_id);
console.log(track);

// Convert album and tracks to deezer
const [album, tracks] = await spotify.album2deezer(album_id);
console.log(album);
console.log(tracks);

// Convert playlist and tracks to deezer
const [playlist, tracks] = await spotify.playlist2Deezer(playlist_id);
console.log(playlist);
console.log(tracks);

// Convert artist tracks to deezer (limited to 10 tracks)
const tracks = await spotify.artist2Deezer(artist_id);
console.log(tracks);
```
