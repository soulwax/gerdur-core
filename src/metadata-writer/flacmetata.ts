import Metaflac from '../lib/metaflac-js';
import type {TrackTagModel} from './model';

export interface FlacWriteOptions {
  /** embed the LRC document as a `SYNCEDLYRICS` Vorbis comment. default true */
  embedSyncedLyrics?: boolean;
}

/**
 * Write Vorbis comments + PICTURE blocks from the canonical model. Vorbis
 * comments are free-form, so every field Deezer gives us lands here — including
 * multi-valued credits (one comment per value) and synced lyrics.
 */
export const writeMetadataFlac = (buffer: Buffer, m: TrackTagModel, options: FlacWriteOptions = {}): Buffer => {
  const flac = new Metaflac(buffer);
  const tag = (key: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') flac.setTag(`${key}=${value}`);
  };
  const multi = (key: string, values: string[]) => {
    for (const v of values) if (v) flac.setTag(`${key}=${v}`);
  };

  tag('TITLE', m.title);
  tag('SUBTITLE', m.subtitle);
  if (m.subtitle) tag('VERSION', m.subtitle);
  tag('ALBUM', m.album);
  multi('ARTIST', m.artists);
  multi('ARTISTS', m.artists);
  tag('ALBUMARTIST', m.albumArtist);
  multi('COMPOSER', m.composers);
  multi('LYRICIST', m.lyricists);
  multi('WRITER', m.lyricists);
  multi('PRODUCER', m.producers);
  multi('MIXER', [...m.mixers, ...m.engineers.filter((e) => e.role.startsWith('mixing')).map((e) => e.name)]);
  multi('PUBLISHER', m.publishers);
  for (const e of m.engineers) tag('ENGINEER', e.name);
  // one human-readable line keeping the role breakdown (Picard-style)
  for (const e of m.engineers) tag('CREDITS', `${e.name} (${e.role})`);
  for (const p of m.performers) tag('PERFORMER', `${p.name} (${p.role})`);
  multi('FEATURING', m.featuredArtists);

  tag('TRACKNUMBER', m.trackNumber || '');
  tag('TRACKTOTAL', m.trackTotal);
  tag('TOTALTRACKS', m.trackTotal);
  tag('DISCNUMBER', m.discNumber || '');
  tag('DISCTOTAL', m.discTotal);
  tag('TOTALDISCS', m.discTotal);

  tag('ISRC', m.isrc);
  tag('BARCODE', m.barcode);
  tag('LENGTH', Math.round(m.durationMs / 1000) || '');
  if (m.bpm) tag('BPM', m.bpm);
  tag('MEDIA', 'Digital Media');

  multi('GENRE', m.genres);
  tag('LABEL', m.label);
  tag('ORGANIZATION', m.label);
  tag('RELEASETYPE', m.releaseType);
  tag('COMPILATION', m.isCompilation ? '1' : '0');

  tag('DATE', m.date);
  tag('YEAR', m.year);
  tag('ORIGINALDATE', m.originalDate);
  tag('ORIGINALYEAR', m.originalYear);

  tag('COPYRIGHT', m.copyright);
  tag('PRODUCERLINE', m.producerLine);

  tag('REPLAYGAIN_TRACK_GAIN', m.replayGainTrackGain);

  tag('ITUNESADVISORY', m.itunesAdvisory);
  if (m.explicit !== 'unknown') tag('EXPLICIT', m.explicit === 'explicit' ? '1' : '0');

  // `LYRICS` carries the synced LRC when we have it (players auto-detect the
  // timestamps); `UNSYNCEDLYRICS` is always the plain fallback.
  const synced = m.lyricsSynced && options.embedSyncedLyrics !== false ? m.lyricsSynced : null;
  if (synced || m.lyrics) {
    tag('LYRICS', synced || m.lyrics);
  }
  if (m.lyrics) {
    tag('UNSYNCEDLYRICS', m.lyrics);
  }
  tag('LYRICS_WRITER', m.lyricsWriters);
  tag('LYRICS_COPYRIGHT', m.lyricsCopyright);

  if (m.rank !== undefined) tag('DEEZER_RANK', m.rank);
  tag('SOURCE', 'Deezer');
  if (m.ids.deezerTrack) {
    tag('SOURCEID', m.ids.deezerTrack);
    tag('DEEZER_TRACK_ID', m.ids.deezerTrack);
  }
  tag('DEEZER_ALBUM_ID', m.ids.deezerAlbum);
  tag('DEEZER_ARTIST_ID', m.ids.deezerArtist);
  tag('DEEZER_LABEL_ID', m.ids.labelId);
  tag('DEEZER_PROVIDER_ID', m.ids.providerId);
  if (m.ids.slug) tag('WEBSITE', `https://www.deezer.com/track/${m.ids.deezerTrack}`);

  if (m.cover) {
    flac.importPicture(m.cover, m.coverSize, 'image/jpeg', 3, 'Front cover');
  }
  if (m.artistImage) {
    flac.importPicture(m.artistImage, 1000, 'image/jpeg', 8, 'Artist');
  }

  return flac.getBuffer();
};
