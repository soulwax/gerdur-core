import test from 'ava';
import {createTagStream, probeAudioOffset} from '../src/metadata-writer/tag-stream';
import {writeMetadataMp3} from '../src/metadata-writer/id3';
import {writeMetadataFlac} from '../src/metadata-writer/flacmetata';
import type {TrackTagModel} from '../src/metadata-writer/model';

/**
 * The streaming writer must be byte-identical to the buffered one — it exists to
 * save memory, not to produce different files.
 */

const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes, 0x7f)]);

const model = (title = 'Harder, Better, Faster, Stronger'): TrackTagModel =>
  ({
    title,
    album: 'Discovery',
    artists: ['Daft Punk'],
    mainArtists: ['Daft Punk'],
    featuredArtists: [],
    albumArtist: 'Daft Punk',
    composers: ['Thomas Bangalter'],
    lyricists: [],
    producers: [],
    engineers: [],
    mixers: [],
    performers: [],
    publishers: [],
    trackNumber: 4,
    discNumber: 1,
    durationMs: 224000,
    genres: ['Electro'],
    isCompilation: false,
    explicit: 'unknown',
    itunesAdvisory: 0,
    ids: {deezerTrack: '3135556'},
    coverSize: 1000,
    cover: jpeg(4096),
    isrc: 'GBDUW0000059',
    date: '2001-03-07',
    year: '2001',
    lyrics: 'work it harder make it better',
  } as TrackTagModel);

/** A minimally valid FLAC: magic + STREAMINFO (last block) + frames. */
const rawFlac = (frameBytes: number): Buffer => {
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0);
  streamInfo.writeUInt16BE(4096, 2);
  const header = Buffer.alloc(4);
  header[0] = 0x80; // last-metadata-block | STREAMINFO
  header.writeUIntBE(34, 1, 3);
  return Buffer.concat([Buffer.from('fLaC'), header, streamInfo, Buffer.alloc(frameBytes, 0x55)]);
};

/** Push `input` through the transform in `chunkSize` pieces and collect the output. */
const runStream = async (input: Buffer, m: TrackTagModel, chunkSize: number): Promise<Buffer> => {
  const stream = createTagStream(m);
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  for (let i = 0; i < input.length; i += chunkSize) {
    stream.write(input.subarray(i, i + chunkSize));
  }
  stream.end();
  await done;
  return Buffer.concat(chunks);
};

test('probeAudioOffset — MP3 with no tag, with a tag, and FLAC', (t) => {
  t.deepEqual(probeAudioOffset(Buffer.alloc(4)), {ready: false}, 'needs 10 bytes to rule out ID3');

  const bare = Buffer.alloc(64, 0x55);
  t.deepEqual(probeAudioOffset(bare), {ready: true, audioOffset: 0, flac: false});

  // ID3v2 header claiming a 1000-byte body (syncsafe)
  const tagged = Buffer.alloc(64);
  tagged.write('ID3', 0, 'ascii');
  tagged[6] = 0;
  tagged[7] = 0;
  tagged[8] = (1000 >> 7) & 0x7f;
  tagged[9] = 1000 & 0x7f;
  t.deepEqual(probeAudioOffset(tagged), {ready: true, audioOffset: 1010, flac: false});

  const flac = rawFlac(100);
  t.deepEqual(probeAudioOffset(flac), {ready: true, audioOffset: 42, flac: true});
  t.deepEqual(probeAudioOffset(flac.subarray(0, 6)), {ready: false}, 'truncated block chain needs more');
});

test('MP3 without an existing tag — streamed output is byte-identical', async (t) => {
  const audio = Buffer.alloc(512 * 1024, 0x55);
  const expected = writeMetadataMp3(audio, model());

  for (const chunkSize of [1, 7, 10, 4096, 64 * 1024, audio.length]) {
    const actual = await runStream(audio, model(), chunkSize);
    t.true(actual.equals(expected), `chunk size ${chunkSize}`);
  }
});

test('MP3 with an existing ID3v2 — the old tag is dropped, output identical', async (t) => {
  // a "downloaded" file that already carries Deezer's tag
  const original = writeMetadataMp3(Buffer.alloc(256 * 1024, 0x55), model('Old Title'));
  const expected = writeMetadataMp3(original, model('New Title'));

  for (const chunkSize of [1, 13, 4096, 64 * 1024]) {
    const actual = await runStream(original, model('New Title'), chunkSize);
    t.true(actual.equals(expected), `chunk size ${chunkSize}`);
  }
});

test('FLAC — streamed output is byte-identical', async (t) => {
  const audio = rawFlac(512 * 1024);
  const expected = writeMetadataFlac(audio, model(), {});

  for (const chunkSize of [1, 7, 42, 4096, 64 * 1024, audio.length]) {
    const actual = await runStream(audio, model(), chunkSize);
    t.true(actual.equals(expected), `chunk size ${chunkSize}`);
  }
});

test('FLAC that already carries metadata — re-tagging is identical', async (t) => {
  const original = writeMetadataFlac(rawFlac(256 * 1024), model('Old Title'), {});
  const expected = writeMetadataFlac(original, model('New Title'), {});

  for (const chunkSize of [1, 4096, 64 * 1024]) {
    const actual = await runStream(original, model('New Title'), chunkSize);
    t.true(actual.equals(expected), `chunk size ${chunkSize}`);
  }
});

test('a source too short to probe still comes out tagged', async (t) => {
  const tiny = Buffer.from([1, 2, 3]);
  const actual = await runStream(tiny, model(), 1);
  t.true(actual.length > tiny.length, 'a tag was written');
  t.true(actual.subarray(0, 3).toString('ascii') === 'ID3');
  t.true(actual.subarray(actual.length - 3).equals(tiny), 'the audio survived');
});
