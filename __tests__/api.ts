import test from 'ava';
import * as api from '../src';
import {ensureDeezerUserAuth, shouldSkipBecauseUnavailable, skipIfRateLimited, skipWithReason} from './helpers';
import {decryptDownload} from '../src/lib/decrypt';
import {getBuffer} from '../src/lib/http';
import {downloadAlbumCover} from '../src/metadata-writer/abumCover';
import {getLyricsMusixmatch} from '../src/metadata-writer/musixmatchLyrics';
import {getTrackDownloadUrl, resolveDownloadUrls} from '../src/lib/get-url';

// Harder, Better, Faster, Stronger by Daft Punk
const SNG_ID = '3135556';

// Discovery by Daft Punk
const ALB_ID = '302127';

test.serial('GET USER INFO', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }
  const response = await api.getUser();

  t.truthy(response.BLOG_NAME);
  t.truthy(response.EMAIL);
  t.truthy(response.USER_ID);
  t.is(response.__TYPE__, 'user');
});

test('GET TRACK INFO', async (t) => {
  const response = await api.getTrackInfo(SNG_ID);

  t.is(response.SNG_ID, SNG_ID);
  t.is(response.ISRC, 'GBDUW0000059');
  t.truthy(response.TRACK_TOKEN);
  t.is(response.__TYPE__, 'song');
});

test('GET TRACK INFO - PUBLIC API', async (t) => {
  try {
    const response = await api.getTrackInfoPublicApi(SNG_ID);
    t.is(response.id, Number(SNG_ID));
    t.is(response.isrc, 'GBDUW0000059');
    t.is(response.type, 'track');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('CONCURRENT IDENTICAL REQUESTS ARE COALESCED', async (t) => {
  // 10 simultaneous callers for one id must share a single in-flight request:
  // the LRU is empty when they start, so without single-flight each hits the wire.
  try {
    const responses = await Promise.all(Array.from({length: 10}, () => api.getAlbumInfoPublicApi('302127')));
    t.is(responses.length, 10);
    for (const r of responses) {
      t.is(r, responses[0], 'every concurrent caller resolves to the same object');
    }
    t.is(Number(responses[0].id), 302127);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('GET TRACK COVER', async (t) => {
  const track = await api.getTrackInfo(SNG_ID);
  const cover = (await downloadAlbumCover(track, 500)) as Buffer;

  t.truthy(cover);
  t.true(Buffer.isBuffer(cover));
  t.true(cover.length > 20000);
});

test('GET TRACK LYRICS', async (t) => {
  let response;
  try {
    response = await api.getLyrics(SNG_ID);
  } catch (err) {
    if (shouldSkipBecauseUnavailable(err, [], ['No lyrics id'])) {
      skipWithReason(t, `Skipping Deezer lyrics fixture ${SNG_ID} because lyrics are unavailable in this region.`);
      return;
    }
    throw err;
  }

  t.is(response.LYRICS_ID, '2780622');
  // Deezer edits the transcript over time (was 1719, later 1774) — assert it
  // came back substantial rather than pinning an exact length.
  t.true(response.LYRICS_TEXT.length > 1500);
  t.regex(response.LYRICS_TEXT, /Harder|Faster|Stronger/);
});

test('GET ALBUM INFO', async (t) => {
  const response = await api.getAlbumInfo(ALB_ID);

  t.is(response.ALB_ID, ALB_ID);
  t.is(response.UPC, '724384960650');
  t.is(response.__TYPE__, 'album');
});

test('GET ALBUM INFO - PUBLIC API', async (t) => {
  try {
    const response = await api.getAlbumInfoPublicApi(ALB_ID);
    t.is(response.id, Number(ALB_ID));
    t.is(response.upc, '724384960650');
    t.is(response.type, 'album');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('GET ALBUM TRACKS', async (t) => {
  const response = await api.getAlbumTracks(ALB_ID);

  t.is(response.count, 14);
  t.is(response.data.length, response.count);
});

test('GET PLAYLIST INFO', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }

  const PLAYLIST_ID = '4523119944';
  const response = await api.getPlaylistInfo(PLAYLIST_ID);

  t.truthy(response.NB_SONG > 0);
  t.truthy(response.PARENT_USERNAME);
  t.is(response.__TYPE__, 'playlist');
});

test('GET PLAYLIST TRACKS', async (t) => {
  const PLAYLIST_ID = '4523119944';
  const response = await api.getPlaylistTracks(PLAYLIST_ID);

  t.truthy(response.count > 0);
  t.is(response.data.length, response.count);
});

test('GET ARTIST INFO', async (t) => {
  const ART_ID = '13';
  const response = await api.getArtistInfo(ART_ID);

  t.is(response.ART_NAME, 'Eminem');
  t.is(response.__TYPE__, 'artist');
});

test('GET ARTIST TRACKS', async (t) => {
  const ART_ID = '13';
  const response = await api.getDiscography(ART_ID, 10);

  t.is(response.count, 10);
  t.is(response.data.length, response.count);
});

test('GET USER PROFILE', async (t) => {
  const USER_ID = '2064440442';
  const response = await api.getProfile(USER_ID);

  t.truthy(response.USER.BLOG_NAME);
  t.is(response.USER.__TYPE__, 'user');
});

test('GET TRACK ALTERNATIVE', async (t) => {
  const ARTIST = 'Eminem';
  const TRACK = 'The Real Slim Shady';
  const response = await api.searchAlternative(ARTIST, TRACK);

  t.is(response.QUERY, `artist:'${ARTIST.toLowerCase()}' track:'${TRACK.toLowerCase()}'`);
  t.is(response.TRACK.data.length, response.TRACK.count);
});

test('SEARCH TRACK, ALBUM & ARTIST', async (t) => {
  const QUERY = 'Eminem';
  const response = await api.searchMusic(QUERY, ['TRACK', 'ALBUM', 'ARTIST'], 1);

  t.is(response.QUERY, QUERY);
  t.truthy(response.TRACK.count > 0);
  t.truthy(response.ALBUM.count > 0);
  t.truthy(response.ARTIST.count > 0);
});

test('BUILD ADVANCED QUERY', (t) => {
  t.is(
    api.buildAdvancedQuery({artist: 'daft punk', durMin: 200, durMax: 400}),
    'artist:"daft punk" dur_min:200 dur_max:400',
  );
  t.is(
    api.buildAdvancedQuery({query: 'one more', track: 'a "b" c', bpmMin: 120}),
    'one more track:"a b c" bpm_min:120',
  );
  t.is(api.buildAdvancedQuery({album: 'discovery', label: 'Virgin'}), 'album:"discovery" label:"Virgin"');
  // negative / non-finite ranges and empty strings are dropped
  t.is(api.buildAdvancedQuery({durMin: -5, bpmMax: NaN, artist: '   '}), '');
  t.is(api.buildAdvancedQuery({}), '');
});

test('SEARCH PUBLIC API — TRACKS with advanced operators', async (t) => {
  // Deezer applies the operators loosely, but free text + `artist:` reliably
  // returns hits and exercises the builder → request path.
  const query = api.buildAdvancedQuery({query: 'one more time', artist: 'daft punk'});
  t.is(query, 'one more time artist:"daft punk"');

  try {
    const response = await api.searchTracks(query, {limit: 2});
    t.true(Array.isArray(response.data));
    t.true(response.total > 0);
    const first = response.data[0];
    t.is(first.type, 'track');
    t.true(typeof first.id === 'number');
    t.truthy(first.preview);
    t.regex(first.isrc ?? '', /^[A-Z]{2}/);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('SEARCH PUBLIC API — ARTISTS & PAGING', async (t) => {
  try {
    const response = await api.searchArtists('daft punk', {limit: 1});
    t.is(response.data[0].type, 'artist');
    t.is(response.data[0].name, 'Daft Punk');
    t.true(response.data[0].nb_fan > 0);

    const page2 = await api.searchTracks('love', {limit: 3, index: 3});
    t.is(page2.data.length, 3);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('SUGGEST', async (t) => {
  let response;
  try {
    response = await api.suggest('daft punk', 3);
  } catch (err) {
    if (shouldSkipBecauseUnavailable(err, [], ['NEED_API_AUTH_REQUIRED', 'VALID_TOKEN_REQUIRED'])) {
      skipWithReason(t, 'Skipping suggest test: the bundled session is rate-limited.');
      return;
    }
    throw err;
  }

  t.is(response.QUERY, 'daft punk');
  t.true(Array.isArray(response.ORDER));
  t.true((response.ARTIST ?? []).some((a) => a.ART_NAME === 'Daft Punk'));
});

test('BROWSE — genres, chart, editorial', async (t) => {
  try {
    const genres = await api.getGenres();
    t.true(genres.data.length > 0);
    t.is(genres.data[0].type, 'genre');
    t.true(genres.data.some((g) => g.id === 0));

    const chart = await api.getChart(0, 3);
    t.true(chart.tracks.data.length > 0);
    t.is(chart.tracks.data[0].position, 1);
    t.is(chart.tracks.data[0].type, 'track');
    t.true(Array.isArray(chart.artists.data));

    const chartTracks = await api.getChartTracks(0, 5);
    t.is(chartTracks.data.length, 5);

    const editorial = await api.getEditorialList();
    t.true(editorial.data.length > 0);
    t.is(editorial.data[0].type, 'editorial');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('BROWSE — artist discovery', async (t) => {
  const DAFT_PUNK = 27;
  try {
    const top = await api.getArtistTopTracks(DAFT_PUNK, 3);
    t.is(top.data.length, 3);
    t.is(top.data[0].type, 'track');

    const related = await api.getRelatedArtists(DAFT_PUNK, 3);
    t.true(related.data.length > 0);
    t.is(related.data[0].type, 'artist');

    const albums = await api.getArtistAlbums(DAFT_PUNK, 3);
    t.true(albums.data.length > 0);
    t.is(albums.data[0].type, 'album');
    t.truthy(albums.data[0].release_date);

    const radio = await api.getArtistRadioTracks(DAFT_PUNK);
    t.true(radio.data.length > 0);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('BROWSE — ISRC / UPC resolution', async (t) => {
  try {
    const track = await api.getTrackByISRC('GBDUW0000059');
    t.is(track.id, 3135556);
    t.is(track.title, 'Harder, Better, Faster, Stronger');
    t.is(track.type, 'track');

    const album = await api.getAlbumByUPC('0724384960650');
    t.is(album.id, 302127);
    t.is(album.title, 'Discovery');
    t.true((album.tracks?.data.length ?? 0) > 0);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('USER — flow, favourites, playlists (public profile)', async (t) => {
  const UID = '2064440442'; // the public profile the profile test already uses
  try {
    const flow = await api.getUserFlow(UID);
    t.true(flow.data.length > 0);
    t.is(flow.data[0].type, 'track');

    const tracks = await api.getUserFavoriteTracks(UID, 3);
    t.true(tracks.total > 0);
    t.true(typeof tracks.data[0].time_add === 'number');

    const artists = await api.getUserFavoriteArtists(UID, 3);
    t.is(artists.data[0].type, 'artist');

    const playlists = await api.getUserPlaylists(UID, 3);
    t.is(playlists.data[0].type, 'playlist');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('USER — radios', async (t) => {
  try {
    const radios = await api.getRadios();
    t.true(radios.data.length > 0);
    t.is(radios.data[0].type, 'radio');

    const radioTracks = await api.getRadioTracks(radios.data[0].id);
    t.true(radioTracks.data.length > 0);
    t.is(radioTracks.data[0].type, 'track');

    const genres = await api.getRadioGenres();
    t.true(genres.data.length > 0);
    t.true(Array.isArray(genres.data[0].radios));
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test('BATCH RESOLVE DOWNLOAD URLS', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }

  // Discovery — first three tracks
  const album = await api.getAlbumTracks(ALB_ID);
  const tracks = album.data.slice(0, 3);

  let resolved;
  try {
    resolved = await resolveDownloadUrls(tracks, [9, 3, 1]);
  } catch (err) {
    if (shouldSkipBecauseUnavailable(err, [403, 429])) {
      skipWithReason(t, 'Skipping batch get_url test: media API is rate-limiting this account.');
      return;
    }
    throw err;
  }

  t.is(resolved.length, tracks.length, 'one result per input track, in order');
  for (const entry of resolved) {
    if (!entry) {
      continue; // geo-blocked / unavailable in this region — acceptable
    }
    t.true(/^https?:\/\//.test(entry.trackUrl), 'a real CDN URL');
    t.true(entry.fileSize > 0, 'a non-zero file size');
    t.true(['FLAC', 'MP3_320', 'MP3_128'].includes(entry.format));
  }
  t.true(
    resolved.some((e) => e !== null),
    'at least one track resolved',
  );
  for (const entry of resolved) {
    if (entry) {
      t.true(['BF_CBC_STRIPE', 'NONE'].includes(entry.cipher), 'cipher is reported');
      t.is(entry.isEncrypted, entry.cipher !== 'NONE');
    }
  }
});

test('FORMAT HELPERS', (t) => {
  t.is(api.formatName(9), 'FLAC');
  t.is(api.formatName(3), 'MP3_320');
  t.is(api.formatName(1), 'MP3_128');
  // format strings pass straight through
  t.is(api.formatName('AAC_64'), 'AAC_64');
  t.is(api.toFormat('MP3_256'), 'MP3_256');
  t.throws(() => api.formatName(7));
  t.true(api.DEEZER_FORMATS.includes('FLAC'));
  t.true(api.DEEZER_FORMATS.includes('AAC_64'));
});

test('TRACK PREVIEW — 30s clip, no auth, no encryption', async (t) => {
  try {
    // from a gw track object (uses MEDIA, no extra request)
    const track = await api.getTrackInfo(SNG_ID);
    const preview = await api.getTrackPreview(track);
    t.truthy(preview);
    t.is(preview?.duration, 30);
    t.regex(preview?.url ?? '', /^https:\/\/.*\.mp3/);

    // from a bare id (public-API lookup)
    const byId = await api.getTrackPreview(SNG_ID);
    t.regex(byId?.url ?? '', /^https:\/\//);

    const clip = await api.downloadPreview(SNG_ID);
    t.true(Buffer.isBuffer(clip));
    t.true((clip?.length ?? 0) > 100_000, 'a real ~30s MP3');
    t.is(clip?.slice(0, 3).toString('latin1'), 'ID3', 'starts with an ID3 tag');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

if (process.env.CI) {
  test('DOWNLOAD TRACK128 & ADD METADATA', async (t) => {
    const track = await api.getTrackInfo(SNG_ID);
    const trackData = await getTrackDownloadUrl(track, 1);
    if (!trackData) throw new Error('Selected track+quality are unavailable');
    const data = await getBuffer(trackData.trackUrl);

    t.truthy(data);
    t.true(Buffer.isBuffer(data));
    t.is(data.length, 3596119);

    const decryptedTrack: Buffer = trackData.isEncrypted ? decryptDownload(data, track.SNG_ID) : data;
    t.true(Buffer.isBuffer(decryptedTrack));
    t.is(decryptedTrack.length, 3596119);

    const {buffer: trackWithMetadata, model} = await api.addTrackTags(decryptedTrack, track, {coverSize: 500});
    t.true(Buffer.isBuffer(trackWithMetadata));
    t.true(trackWithMetadata.length > decryptedTrack.length, 'tags were added');
    t.is(model.isrc, 'GBDUW0000059');
    t.true(model.replayGainTrackGain?.endsWith(' dB'));
  });

  test('STREAM TRACK DOWNLOAD === buffered decrypt', async (t) => {
    const track = await api.getTrackInfo(SNG_ID);

    const trackData = await getTrackDownloadUrl(track, 1);
    if (!trackData) throw new Error('unavailable');
    const reference = trackData.isEncrypted
      ? decryptDownload(await getBuffer(trackData.trackUrl), track.SNG_ID)
      : await getBuffer(trackData.trackUrl);

    let lastReceived = 0;
    const ts = await api.streamTrackDownload(track, 1, {onProgress: (r) => (lastReceived = r)});
    const chunks: Buffer[] = [];
    for await (const c of ts.stream) chunks.push(c as Buffer);
    const streamed = Buffer.concat(chunks);

    t.is(streamed.length, reference.length);
    t.true(streamed.equals(reference), 'streamed bytes are identical to the buffered path');
    t.true(lastReceived > 0, 'progress was reported');

    // resume from a chunk-aligned midpoint
    const half = Math.floor(reference.length / 2 / 2048) * 2048;
    const resumed = await api.streamTrackDownload(track, 1, {resumeFrom: half});
    const tailChunks: Buffer[] = [];
    for await (const c of resumed.stream) tailChunks.push(c as Buffer);
    t.true(Buffer.concat(tailChunks).equals(reference.subarray(half)), 'resumed tail matches');
  });

  // test('TRACK128 WITHOUT ALBUM INFO', async (t) => {
  //   const track = await api.getTrackInfo('912254892');
  //   const trackData = await getTrackDownloadUrl(track, 1);
  //   if (!trackData) throw new Error("Selected track+quality are unavailable");
  //   const data = await getBuffer(trackData.trackUrl);

  //   t.truthy(data);
  //   t.true(Buffer.isBuffer(data));
  //   t.is(data.length, 3262170);

  //   const decryptedTrack: Buffer = trackData.isEncrypted ? decryptDownload(data, track.SNG_ID) : data;
  //   t.true(Buffer.isBuffer(decryptedTrack));
  //   t.is(decryptedTrack.length, 3262170);

  //   if (!process.env.CI) {
  //     const trackWithMetadata = await api.addTrackTags(decryptedTrack, track, 500);
  //     t.true(Buffer.isBuffer(trackWithMetadata));
  //     t.true(trackWithMetadata.length === 3326050);
  //   }
  // });

  test('DOWNLOAD TRACK320 & ADD METADATA', async (t) => {
    const track = await api.getTrackInfo(SNG_ID);
    const trackData = await getTrackDownloadUrl(track, 3);
    if (!trackData) throw new Error('Selected track+quality are unavailable');
    const data = await getBuffer(trackData.trackUrl);

    t.truthy(data);
    t.true(Buffer.isBuffer(data));
    t.is(data.length, 8990301);

    const decryptedTrack: Buffer = trackData.isEncrypted ? decryptDownload(data, track.SNG_ID) : data;
    t.true(Buffer.isBuffer(decryptedTrack));
    t.is(decryptedTrack.length, 8990301);

    const {buffer: trackWithMetadata} = await api.addTrackTags(decryptedTrack, track, {coverSize: 500});
    t.true(Buffer.isBuffer(trackWithMetadata));
    t.true(trackWithMetadata.length > decryptedTrack.length, 'tags were added');
  });

  test('DOWNLOAD TRACK1411 & ADD METADATA', async (t) => {
    const track = await api.getTrackInfo(SNG_ID);
    const trackData = await getTrackDownloadUrl(track, 9);
    if (!trackData) throw new Error('Selected track+quality are unavailable');
    const data = await getBuffer(trackData.trackUrl);

    t.truthy(data);
    t.true(Buffer.isBuffer(data));
    t.is(data.length, 25418289);

    const decryptedTrack: Buffer = trackData.isEncrypted ? decryptDownload(data, track.SNG_ID) : data;
    t.true(Buffer.isBuffer(decryptedTrack));
    t.is(data.length, 25418289);

    const {buffer: trackWithMetadata, model} = await api.addTrackTags(decryptedTrack, track, {coverSize: 500});
    t.true(Buffer.isBuffer(trackWithMetadata));
    t.is(trackWithMetadata.slice(0, 4).toString('ascii'), 'fLaC', 'still a FLAC');
    t.true(trackWithMetadata.length > decryptedTrack.length, 'tags were added');
    t.true(model.genres.length > 0, 'genres resolved from album');
  });
} else {
  test('GET MUSIXMATCH LYRICS', async (t) => {
    const track = await api.getTrackInfo(SNG_ID);
    let lyrics;
    try {
      lyrics = await getLyricsMusixmatch(`${track.ART_NAME} - ${track.SNG_TITLE}`);
    } catch (err) {
      if (shouldSkipBecauseUnavailable(err, [403])) {
        skipWithReason(t, 'Skipping Musixmatch live test because the endpoint returned 403.');
        return;
      }
      throw err;
    }

    t.truthy(lyrics);
    t.true(lyrics.length > 1600);
    t.true(lyrics.length < 1700);
  });
}

test('GET SHOW LIST', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }

  const show = await api.getShowInfo('338532', 10);
  t.is(show.DATA.LABEL_ID, '201952');
  t.is(show.EPISODES.count, 10);
  t.true(Array.isArray(show.EPISODES.data));
});

test('PODCAST — episode + show episodes', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }

  const episodes = await api.getShowEpisodes('1235862', 3);
  t.is(episodes.data.length, 3);
  t.true((episodes.total ?? 0) > 3);

  const episode = await api.getEpisode(episodes.data[0].EPISODE_ID);
  t.is(episode.EPISODE_ID, episodes.data[0].EPISODE_ID);
  t.truthy(episode.EPISODE_DIRECT_STREAM_URL || episode.MD5_ORIGIN);
  t.true(Number(episode.DURATION) > 0);
});

test('REFRESH TRACK TOKENS — batch', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }

  const {data} = await api.getAlbumTracks('302127');
  const tracks = data.slice(0, 3);
  const forcedStale = tracks.map((tr) => ({...tr, TRACK_TOKEN_EXPIRE: 1}));

  const refreshed = await api.refreshTrackTokens(forcedStale);
  t.is(refreshed.length, forcedStale.length);
  for (let i = 0; i < refreshed.length; i++) {
    t.not(refreshed[i].TRACK_TOKEN, forcedStale[i].TRACK_TOKEN, 'token was replaced');
    t.true(refreshed[i].TRACK_TOKEN_EXPIRE * 1000 > Date.now(), 'new token is in the future');
  }
  // a second pass is a no-op — nothing stale
  t.is((await api.refreshTrackTokens(refreshed))[0], refreshed[0]);
});

test('GET CHANNEL LIST', async (t) => {
  const channel = await api.getChannelList();
  t.is(channel.count, channel.data.length);
  t.true(Array.isArray(channel.data));
});

test('GET PLAYLIST CHANNEL', async (t) => {
  if (!(await ensureDeezerUserAuth(t))) {
    return;
  }

  const channel = await api.getPlaylistChannel('channels/dance');
  // Deezer trims/reorders the envelope keys over time — assert the stable ones.
  for (const key of ['version', 'page_id', 'title', 'sections']) {
    t.true(key in channel, `channel is missing "${key}"`);
  }
  t.truthy(channel.title);
  t.true(Array.isArray(channel.sections));
});
