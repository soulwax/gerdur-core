import {getLyricsMusixmatch} from './musixmatchLyrics';
import {getLyrics} from '../api';
import type {lyricsType, trackType} from '../types';

const getTrackLyricsWeb = async (track: trackType): Promise<lyricsType | null> => {
  try {
    const LYRICS_TEXT = await getLyricsMusixmatch(`${track.ART_NAME} - ${track.SNG_TITLE}`);
    return {LYRICS_TEXT};
  } catch (err) {
    return null;
  }
};

/**
 * Deezer's lyrics, falling back to scraping Musixmatch when a track has no
 * `LYRICS_ID` (instrumentals, and anything Deezer simply lacks).
 *
 * That fallback is not free: it is two requests per track that has no Deezer
 * lyrics — 16 of them on a 14-track album — and it fails outright wherever
 * Musixmatch blocks the request. Pass `fallback: false` to skip it and keep only
 * what Deezer serves.
 */
export const getTrackLyrics = async (track: trackType, fallback = true): Promise<lyricsType | null> => {
  if (track.LYRICS_ID > 0) {
    try {
      return await getLyrics(track.SNG_ID);
    } catch (err) {
      return fallback ? await getTrackLyricsWeb(track) : null;
    }
  }

  return fallback ? await getTrackLyricsWeb(track) : null;
};
