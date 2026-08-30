# Parse

Parse Deezer, Spotify and Tidal URLs to downloadable data.

## Usage

`parseInfo` parses information as json data. Throws `Error`, make sure to catch error on your side.

```ts
import {parseInfo} from 'gerdur-core';

// Get link information
const info = await parseInfo(url);
console.log(info);
```
