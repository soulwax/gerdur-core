/**
 * Optional, pluggable **enrichment** against third-party open databases —
 * strictly read-only, off by default, never wired into `addTrackTags`. Use it to
 * fill gaps Deezer leaves: canonical release/label data (MusicBrainz, by ISRC)
 * and higher-resolution cover art (Cover Art Archive).
 *
 * Both services are rate-limited and want a descriptive `User-Agent` —
 * `configureMusicBrainz({userAgent})` before first use.
 */
export {PoliteJsonClient} from './client';
export {
  configureMusicBrainz,
  lookupRecordingByISRC,
  getMusicBrainzRecording,
  getMusicBrainzRelease,
} from './musicbrainz';
export type {MBRecording, MBRelease, MBArtistCredit} from './musicbrainz';
export {getCoverArt, getBestCoverArtUrl} from './coverart';
export type {CoverArt, CoverArtImage} from './coverart';
