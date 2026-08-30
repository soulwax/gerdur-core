// @ts-ignore
import id3Writer from 'browser-id3-writer';
import type {TrackTagModel} from './model';

const join = (arr: string[]) => arr.filter(Boolean).join('; ');

/**
 * Write an ID3v2.3 tag from the canonical model. `browser-id3-writer` is a v2.3
 * writer, so there is no `SYLT` (synced lyrics) or `TDRC`/`TDOR` — synced lyrics
 * ship as a `.lrc` sidecar from the CLI, and dates use `TYER`/`TDAT` plus
 * `TXXX:ORIGINALDATE`.
 */
export const writeMetadataMp3 = (buffer: Buffer, m: TrackTagModel): Buffer => {
  const w = new id3Writer(buffer);
  const txxx = (description: string, value: string | string[]) => {
    const v = Array.isArray(value) ? join(value) : value;
    if (v) w.setFrame('TXXX', {description, value: v});
  };

  w.setFrame('TIT2', m.title);
  if (m.subtitle) w.setFrame('TIT3', m.subtitle);
  w.setFrame('TALB', m.album);
  if (m.artists.length) w.setFrame('TPE1', m.artists);
  if (m.albumArtist) w.setFrame('TPE2', m.albumArtist);
  if (m.composers.length) w.setFrame('TCOM', m.composers);
  if (m.lyricists.length) w.setFrame('TEXT', join(m.lyricists));
  if (m.mixers.length) w.setFrame('TPE4', join(m.mixers));
  if (m.genres.length) w.setFrame('TCON', m.genres);
  if (m.label) w.setFrame('TPUB', m.label);
  if (m.isrc) w.setFrame('TSRC', m.isrc);
  if (m.durationMs) w.setFrame('TLEN', m.durationMs);
  if (m.bpm) w.setFrame('TBPM', Math.round(m.bpm));
  w.setFrame('TMED', 'Digital Media');

  if (m.trackNumber) {
    w.setFrame('TRCK', m.trackTotal ? `${m.trackNumber}/${m.trackTotal}` : String(m.trackNumber));
  }
  if (m.discNumber) {
    w.setFrame('TPOS', m.discTotal ? `${m.discNumber}/${m.discTotal}` : String(m.discNumber));
  }

  if (m.year) w.setFrame('TYER', Number(m.year));
  if (m.date && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) {
    const [, mm, dd] = m.date.split('-');
    w.setFrame('TDAT', Number(dd + mm));
  }
  if (m.copyright) w.setFrame('TCOP', m.copyright);

  // v2.3 has no native frames for these — user-defined text, Picard-compatible keys
  txxx('DATE', m.date || '');
  txxx('ORIGINALDATE', m.originalDate || '');
  txxx('ORIGINALYEAR', m.originalYear || '');
  txxx('BARCODE', m.barcode || '');
  if (m.bpm) txxx('BPM', String(m.bpm));
  txxx('RELEASETYPE', m.releaseType || '');
  txxx('COMPILATION', m.isCompilation ? '1' : '0');
  txxx('ITUNESADVISORY', String(m.itunesAdvisory));
  if (m.explicit !== 'unknown') txxx('EXPLICIT', m.explicit === 'explicit' ? '1' : '0');
  if (m.replayGainTrackGain) txxx('REPLAYGAIN_TRACK_GAIN', m.replayGainTrackGain);
  if (m.artists.length > 1) txxx('ARTISTS', m.artists);
  if (m.featuredArtists.length) txxx('FEATURING', m.featuredArtists);
  txxx('PRODUCER', m.producers);
  txxx('MIXER', m.mixers);
  txxx('PUBLISHER', m.publishers);
  if (m.engineers.length) {
    txxx(
      'ENGINEER',
      m.engineers.map((e) => e.name),
    );
    txxx(
      'INVOLVEDPEOPLE',
      m.engineers.map((e) => `${e.name} (${e.role})`),
    );
  }
  if (m.performers.length) {
    txxx(
      'PERFORMER',
      m.performers.map((p) => `${p.name} (${p.role})`),
    );
  }
  if (m.lyricsWriters) txxx('LYRICIST', m.lyricsWriters);
  if (m.lyricsCopyright) txxx('LYRICS_COPYRIGHT', m.lyricsCopyright);
  if (m.producerLine) txxx('PRODUCERLINE', m.producerLine);
  if (m.rank !== undefined) txxx('DEEZER_RANK', String(m.rank));

  txxx('SOURCE', 'Deezer');
  if (m.ids.deezerTrack) {
    txxx('SOURCEID', m.ids.deezerTrack);
    txxx('DEEZER_TRACK_ID', m.ids.deezerTrack);
    w.setFrame('WOAS', `https://www.deezer.com/track/${m.ids.deezerTrack}`);
  }
  if (m.ids.deezerAlbum) txxx('DEEZER_ALBUM_ID', m.ids.deezerAlbum);
  if (m.ids.deezerArtist) {
    txxx('DEEZER_ARTIST_ID', m.ids.deezerArtist);
    w.setFrame('WOAR', `https://www.deezer.com/artist/${m.ids.deezerArtist}`);
  }
  if (m.ids.labelId) txxx('DEEZER_LABEL_ID', m.ids.labelId);
  if (m.ids.providerId) txxx('DEEZER_PROVIDER_ID', m.ids.providerId);

  if (m.lyrics) {
    w.setFrame('USLT', {description: '', lyrics: m.lyrics, language: 'eng'});
  }

  if (m.cover) {
    w.setFrame('APIC', {type: 3, data: m.cover, description: 'Front cover'});
  }
  if (m.artistImage) {
    w.setFrame('APIC', {type: 8, data: m.artistImage, description: 'Artist'});
  }

  w.addTag();
  return Buffer.isBuffer(w.arrayBuffer) ? w.arrayBuffer : Buffer.from(w.arrayBuffer);
};
