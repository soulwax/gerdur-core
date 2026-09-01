import {parse} from 'node-html-parser';
import {getText} from '../lib/http';
import {randomUseragent} from './useragents';

const baseUrl = 'https://musixmatch.com';

/**
 * Musixmatch is a *fallback* for tracks Deezer has no lyrics for — two scraped
 * page loads each. Where Musixmatch blocks the request (it 403s from plenty of
 * networks and datacentres) every one of those still costs a round trip and
 * still returns nothing: measured at **2021 ms per 14-track album, 70% of all
 * tagging time**, for 3 KB of error pages.
 *
 * So after a few consecutive *transport* failures the scraper latches off for
 * the rest of the process. A track simply not being on Musixmatch does **not**
 * count — that means the service is working fine — so a run of obscure tracks
 * can't disable a fallback that would otherwise work. Any success resets it.
 */
let consecutiveTransportFailures = 0;
let latchedOff = false;
let maxFailures = 3;

/** Errors we raise ourselves for a legitimate miss, as opposed to the service failing. */
const MISS = /^No (song|lyrics) found!$/;

export interface MusixmatchOptions {
  /** consecutive transport failures before the scraper latches off. Default 3. */
  maxFailures?: number;
  /** force it back on (or off) — also clears the failure count when enabling */
  enabled?: boolean;
}

/** Tune or reset the Musixmatch fallback. */
export const configureMusixmatch = (options: MusixmatchOptions = {}): void => {
  if (typeof options.maxFailures === 'number' && options.maxFailures > 0) {
    maxFailures = Math.floor(options.maxFailures);
  }
  if (options.enabled !== undefined) {
    latchedOff = !options.enabled;
    if (options.enabled) {
      consecutiveTransportFailures = 0;
    }
  }
};

/** Whether the fallback is still being attempted, and how close it is to latching off. */
export const musixmatchStatus = (): {available: boolean; consecutiveFailures: number; maxFailures: number} => ({
  available: !latchedOff,
  consecutiveFailures: consecutiveTransportFailures,
  maxFailures,
});

const getUrlMusixmatch = async (query: string) => {
  const data = await getText(`${baseUrl}/search/${encodeURI(query)}/tracks`, {
    headers: {
      'User-Agent': randomUseragent(),
      referer: 'https://l.facebook.com/',
    },
  });

  const childNode = parse(data).querySelector('h2')?.childNodes.at(0);
  const url: string | undefined = (childNode as any)?.attributes.href.replace('/add', '');
  if (url && url.includes('/lyrics/')) {
    return url.startsWith('/lyrics/') ? baseUrl + url : url;
  }

  throw new Error('No song found!');
};

const scrape = async (query: string): Promise<string> => {
  const url = await getUrlMusixmatch(query);
  const data = await getText(url, {
    headers: {
      'User-Agent': randomUseragent(),
      referer: baseUrl + '/',
    },
  });

  const lyricsMatch = data.match(/("body":".*","language")/);
  if (!lyricsMatch) {
    throw new Error('No lyrics found!');
  }

  let lyrics = lyricsMatch[0];
  lyrics = lyrics.replace('"body":"', '').replace('","language"', '');

  return lyrics.split('\\n').join('\n');
};

export const getLyricsMusixmatch = async (query: string): Promise<string> => {
  if (latchedOff) {
    throw new Error('Musixmatch fallback is unavailable from this network (latched off)');
  }

  try {
    const lyrics = await scrape(query);
    consecutiveTransportFailures = 0; // it works — forget any earlier trouble
    return lyrics;
  } catch (err) {
    // a track that simply isn't there says nothing about the service
    if (!MISS.test((err as Error)?.message ?? '')) {
      consecutiveTransportFailures += 1;
      if (consecutiveTransportFailures >= maxFailures) {
        latchedOff = true;
      }
    }
    throw err;
  }
};
