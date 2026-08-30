import test from 'ava';
import {normalizeContributors} from '../src/metadata-writer/contributors';
import {toLrc} from '../src/metadata-writer/lrc';
import {buildTagModel} from '../src/metadata-writer/model';
import type {trackType} from '../src/types';

test('normalizeContributors — handles the dirty key spellings Deezer ships', (t) => {
  // real shapes seen across the catalogue
  const gorillaz = normalizeContributors({
    main_artist: ['Gorillaz'],
    featuring: ['Little Dragon'],
    masteringengineer: ['Howie Weinberg'],
    mixingengineer: ['Jason Cox'],
    recordingengineer: ['Jason Cox', 'Stephen Sedgwick'],
    author: ['Damon Albarn', 'Yukimi Nagano'],
  });
  t.deepEqual(gorillaz.mainArtists, ['Gorillaz']);
  t.deepEqual(gorillaz.featuring, ['Little Dragon']);
  t.deepEqual(gorillaz.lyricists, ['Damon Albarn', 'Yukimi Nagano']);
  t.is(gorillaz.engineers.find((e) => e.role === 'mastering engineer')?.name, 'Howie Weinberg');
  t.is(gorillaz.engineers.filter((e) => e.role === 'recording engineer').length, 2);

  // `mainartist` (no underscore) + `music publisher` (with a space)
  const neon = normalizeContributors({
    mainartist: ['Neon Indian'],
    'music publisher': ['Big Life'],
    lyricist: ['Alan Palomo'],
  });
  t.deepEqual(neon.mainArtists, ['Neon Indian']);
  t.deepEqual(neon.publishers, ['Big Life']);
  t.deepEqual(neon.lyricists, ['Alan Palomo']);

  // `artist` as a flat list
  const flat = normalizeContributors({artist: ['Daft Punk', 'Julian Casablancas']});
  t.deepEqual(flat.mainArtists, ['Daft Punk', 'Julian Casablancas']);

  // empty-array form
  t.deepEqual(normalizeContributors([]).mainArtists, []);
  t.deepEqual(normalizeContributors(undefined).engineers, []);
});

test('toLrc — well-formed LRC from LYRICS_SYNC_JSON, empty entries dropped', (t) => {
  const lrc = toLrc(
    [
      {lrc_timestamp: '[00:00.00]', milliseconds: '', duration: '', line: ''},
      {lrc_timestamp: '[00:12.34]', milliseconds: '12340', duration: '2000', line: 'first line'},
      {lrc_timestamp: '[01:05.60]', milliseconds: '65600', duration: '1500', line: 'second line'},
    ],
    {title: 'X', artist: 'Y', length: 90},
  );
  t.truthy(lrc);
  const doc = lrc || '';
  t.true(doc.includes('[ti:X]'));
  t.true(doc.includes('[length:01:30.00]'));
  t.true(doc.includes('[00:12.34]first line'));
  t.true(doc.includes('[01:05.60]second line'));
  t.false(doc.includes('[00:00.00]\n'), 'the empty line is dropped');
  t.is(toLrc(undefined), null);
  t.is(toLrc([]), null);
});

test('buildTagModel — ReplayGain, featured artists, original date, explicit enum', (t) => {
  const track = {
    SNG_ID: '1',
    ALB_ID: '2',
    ART_ID: '3',
    SNG_TITLE: 'Song',
    ALB_TITLE: 'Album',
    ART_NAME: 'Main',
    DURATION: '200',
    TRACK_NUMBER: 4,
    DISK_NUMBER: '1',
    ISRC: 'AA0000000000',
    GAIN: '-8.7',
    RANK: '500000',
    VERSION: '',
    PROVIDER_ID: '3',
    URL_REWRITING: 'main',
    ARTISTS: [{ART_NAME: 'Main'}, {ART_NAME: 'Guest'}],
    EXPLICIT_TRACK_CONTENT: {EXPLICIT_LYRICS_STATUS: 1, EXPLICIT_COVER_STATUS: 0},
    SNG_CONTRIBUTORS: {main_artist: ['Main'], featuring: ['Guest'], composer: ['C']},
  } as unknown as trackType;

  const model = buildTagModel({
    track,
    album: {
      id: '2',
      title: 'Album',
      albumArtist: 'Main',
      genres: ['Pop'],
      label: 'A Label',
      copyright: '© 2010 X',
      producerLine: '℗ 2010 X',
      releaseDate: '2010-03-03',
      originalDate: '1999-01-01',
      upc: '000',
      recordType: 'album',
      isCompilation: false,
      isLive: false,
      trackTotal: 12,
      discTotal: 1,
    },
    publicTrack: {bpm: 128, release_date: '2010-03-03', title_version: ''} as any,
    lyrics: null,
    coverSize: 500,
    deezerIds: true,
    includeRank: true,
  });

  t.is(model.replayGainTrackGain, '-8.70 dB');
  t.deepEqual(model.featuredArtists, ['Guest']);
  t.deepEqual(model.artists, ['Main', 'Guest']);
  t.is(model.date, '2010-03-03');
  t.is(model.originalDate, '1999-01-01');
  t.is(model.originalYear, '1999');
  t.is(model.explicit, 'explicit');
  t.is(model.itunesAdvisory, 1);
  t.is(model.bpm, 128);
  t.is(model.label, 'A Label');
  t.is(model.copyright, '© 2010 X');
  t.is(model.producerLine, '℗ 2010 X');
  t.is(model.ids.deezerTrack, '1');
  t.is(model.rank, 500000);
});
