/**
 * Streaming tag writer — rewrite a track's tags as bytes flow through, without
 * ever holding the audio.
 *
 * `addTrackTags` has to materialise the whole file: `browser-id3-writer`
 * allocates `audio.length + tag` and copies the audio into it (and copies again
 * to strip an existing ID3v2), and the FLAC path concatenates the same way. That
 * is ~2–3× the file size per concurrent call — measured at **+121 MB retained
 * for a 40 MB MP3** — which is what caps concurrency on a server and what
 * quietly cancels `streamTrackDownload`'s constant-memory guarantee at the last
 * step.
 *
 * Both container formats put their metadata at the *front*, so none of that
 * copying is necessary:
 *
 * - **MP3** — an ID3v2 tag is a 10-byte header plus a syncsafe length. Emit a
 *   freshly built tag, discard exactly that many bytes of the source as they go
 *   past, pass the rest through. Nothing is buffered at all.
 * - **FLAC** — `fLaC` then a chain of metadata blocks, the last flagged. Buffer
 *   only that chain (to parse STREAMINFO and friends), emit the rebuilt blocks,
 *   pass the frames through untouched.
 *
 * Peak memory becomes O(metadata) instead of O(file): a few KB for MP3, and for
 * FLAC whatever the source's own metadata region is.
 *
 * The tag bytes come from the exact same writers `addTrackTags` uses — called
 * with an empty / truncated source so they emit only the header — so output is
 * byte-identical to the buffered path.
 *
 * ```ts
 * import {pipeline} from 'stream/promises';
 * const {stream} = await streamTrackDownload(track, 9);
 * await pipeline(stream, createTagStream(model), createWriteStream('out.flac'));
 * ```
 */
import {Transform} from 'stream';
import {writeMetadataFlac} from './flacmetata';
import type {FlacWriteOptions} from './flacmetata';
import {writeMetadataMp3} from './id3';
import type {TrackTagModel} from './model';

/**
 * Cap on how much of the source is buffered while looking for the end of its
 * metadata region. Only FLAC ever gets here, and only for its own metadata
 * (STREAMINFO + SEEKTABLE + any embedded art). Past this the stream errors
 * rather than growing without bound.
 */
const MAX_HEADER_BYTES = 16 * 1024 * 1024;

type Probe = {ready: false} | {ready: true; audioOffset: number; flac: boolean};

/**
 * Where the audio starts in the source, and which container it is.
 * `{ready: false}` means "need more bytes".
 */
export const probeAudioOffset = (buf: Buffer): Probe => {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC') {
    // fLaC | (1 byte: last-block flag + type)(3 bytes: length)[body] ...
    let offset = 4;
    for (;;) {
      if (offset + 4 > buf.length) {
        return {ready: false};
      }
      const isLast = buf.readUInt8(offset) >= 128;
      offset += 4 + buf.readUIntBE(offset + 1, 3);
      if (isLast) {
        // the whole chain must be present for the FLAC parser to walk it
        return offset <= buf.length ? {ready: true, audioOffset: offset, flac: true} : {ready: false};
      }
    }
  }

  if (buf.length < 10) {
    return {ready: false};
  }
  if (buf.toString('ascii', 0, 3) !== 'ID3') {
    return {ready: true, audioOffset: 0, flac: false}; // no existing tag — audio from byte 0
  }
  // ID3v2 size is 4 syncsafe bytes (7 bits each) at offset 6
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
  return {ready: true, audioOffset: 10 + size, flac: false};
};

/**
 * A `Transform` that replaces the tags on a track as it streams through.
 *
 * Feed it the decrypted audio (e.g. from {@link streamTrackDownload}); it emits
 * the same bytes {@link addTrackTags} would produce, without buffering the file.
 * Detects MP3 vs FLAC from the source itself.
 *
 * @param model   the canonical tag model — from `buildTagModel`, or the `model`
 *                an earlier `addTrackTags` call returned
 * @param options forwarded to the FLAC writer (e.g. `embedSyncedLyrics`)
 */
export const createTagStream = (model: TrackTagModel, options: FlacWriteOptions = {}): Transform => {
  let head: Buffer[] = [];
  let headLength = 0;
  /** 'probing' → reading the source header; 'skipping' → dropping its old tag; 'passthrough' → audio */
  let mode: 'probing' | 'skipping' | 'passthrough' = 'probing';
  let toSkip = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      if (mode === 'passthrough') {
        this.push(part);
        return callback();
      }

      if (mode === 'skipping') {
        if (part.length <= toSkip) {
          toSkip -= part.length;
        } else {
          this.push(part.subarray(toSkip));
          toSkip = 0;
          mode = 'passthrough';
        }
        return callback();
      }

      head.push(part);
      headLength += part.length;
      if (headLength > MAX_HEADER_BYTES) {
        return callback(new Error(`No audio found in the first ${MAX_HEADER_BYTES} bytes — is this a track?`));
      }

      const buffered = head.length === 1 ? head[0] : Buffer.concat(head, headLength);
      const probe = probeAudioOffset(buffered);
      if (!probe.ready) {
        head = [buffered];
        return callback();
      }

      try {
        if (probe.flac) {
          // truncating at audioOffset makes the writer's own `slice(framesOffset)`
          // empty, so it returns exactly `fLaC` + the rebuilt metadata blocks
          this.push(writeMetadataFlac(buffered.subarray(0, probe.audioOffset), model, options));
          this.push(buffered.subarray(probe.audioOffset));
          mode = 'passthrough';
        } else {
          // an empty source makes the ID3 writer emit only the tag
          this.push(writeMetadataMp3(Buffer.alloc(0), model));
          if (buffered.length > probe.audioOffset) {
            this.push(buffered.subarray(probe.audioOffset));
            mode = 'passthrough';
          } else {
            toSkip = probe.audioOffset - buffered.length;
            mode = 'skipping';
          }
        }
      } catch (err) {
        return callback(err as Error);
      }

      head = [];
      headLength = 0;
      return callback();
    },

    flush(callback) {
      // a source too short to probe (or one that never closed its metadata
      // chain) — tag what we have rather than dropping it
      if (mode === 'probing' && headLength > 0) {
        const buffered = head.length === 1 ? head[0] : Buffer.concat(head, headLength);
        try {
          this.push(writeMetadataMp3(Buffer.alloc(0), model));
          this.push(buffered);
        } catch (err) {
          return callback(err as Error);
        }
      }
      return callback();
    },
  });
};
