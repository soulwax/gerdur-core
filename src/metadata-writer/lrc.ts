import type {lyricsSync} from '../types';

export interface LrcMeta {
  title?: string;
  artist?: string;
  album?: string;
  writers?: string;
  length?: number; // seconds
}

const stamp = (ms: number): string => {
  const cs = Math.round(ms / 10);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

/**
 * Render Deezer's `LYRICS_SYNC_JSON` as a standard LRC document.
 *
 * Deezer already gives each line an `lrc_timestamp` like `[00:52.64]`; we trust
 * `milliseconds` and re-stamp so the output is well-formed even when a line has
 * an empty timestamp (section breaks come through as `{line: ""}`).
 */
export const toLrc = (sync: lyricsSync[] | undefined, meta: LrcMeta = {}): string | null => {
  if (!sync || !sync.length) {
    return null;
  }

  const head: string[] = [];
  if (meta.artist) head.push(`[ar:${meta.artist}]`);
  if (meta.title) head.push(`[ti:${meta.title}]`);
  if (meta.album) head.push(`[al:${meta.album}]`);
  if (meta.writers) head.push(`[au:${meta.writers}]`);
  if (meta.length) head.push(`[length:${stamp(meta.length * 1000)}]`);
  head.push('[re:gerdur]');

  const lines = sync
    .filter((l) => l.line && l.line.trim().length)
    .map((l) => {
      const ms = Number(l.milliseconds);
      const ts = l.milliseconds && Number.isFinite(ms) ? `[${stamp(ms)}]` : l.lrc_timestamp || '';
      return `${ts}${l.line}`;
    });

  return [...head, ...lines].join('\n') + '\n';
};
