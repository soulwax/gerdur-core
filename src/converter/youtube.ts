import {parse} from 'node-html-parser';
import {searchAlternative, searchMusic} from '../api';
import {getText} from '../lib/http';
import type {trackType} from '../types';

type YoutubePlayerResponse = {
  videoDetails?: {
    title?: string;
  };
};

type YoutubeInitialData = {
  contents?: {
    twoColumnWatchNextResults?: {
      results?: {
        results?: {
          contents?: Array<{
            videoSecondaryInfoRenderer?: {
              metadataRowContainer?: {
                metadataRowContainerRenderer?: {
                  rows?: Array<{
                    metadataRowRenderer?: {
                      title?: {
                        simpleText?: string;
                      };
                      contents?: Array<{
                        simpleText?: string;
                        runs?: Array<{
                          text?: string;
                        }>;
                      }>;
                    };
                  }>;
                };
              };
            };
          }>;
        };
      };
    };
  };
};

const parseInlineObject = <T>(document: string, variableName: string): T | null => {
  const prefix = `${variableName} = `;
  const start = document.indexOf(prefix);
  if (start === -1) {
    return null;
  }

  const jsonStart = start + prefix.length;
  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = jsonStart; index < document.length; index++) {
    const char = document[index];

    if (isInString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        isInString = false;
      }
      continue;
    }

    if (char === '"') {
      isInString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(document.slice(jsonStart, index + 1)) as T;
      }
    }
  }

  return null;
};

const searchTrackByTitle = async (title: string): Promise<trackType | undefined> => {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\(off.*\)/i, '')
    .replace(/official video/gi, '')
    .replace(/lyrics?/gi, '')
    .replace(/ft.*/i, '')
    .replace(/[,-.]/g, ' ')
    .replace(/  +/g, ' ')
    .trim();

  if (!normalizedTitle) {
    return undefined;
  }

  const {TRACK} = await searchMusic(normalizedTitle, ['TRACK'], 20);
  const filteredTracks = TRACK.data.filter((track) => normalizedTitle.includes(track.ART_NAME.toLowerCase()));
  return filteredTracks[0] || TRACK.data[0];
};

const getTrack = async (id: string) => {
  const response = await getText(`https://www.youtube.com/watch?v=${id}&hl=en`);
  const scripts = parse(response)
    .querySelectorAll('script')
    .map((script) => script.text)
    .join('\n');

  const playerResponse = parseInlineObject<YoutubePlayerResponse>(scripts, 'var ytInitialPlayerResponse');
  const initialData = parseInlineObject<YoutubeInitialData>(scripts, 'var ytInitialData');

  const rows = initialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find((content) =>
    Boolean(content.videoSecondaryInfoRenderer),
  )?.videoSecondaryInfoRenderer?.metadataRowContainer?.metadataRowContainerRenderer?.rows;

  if (rows && rows.length > 0) {
    const song = rows.find((row) => row.metadataRowRenderer?.title?.simpleText === 'Song');
    const artist = rows.find((row) => row.metadataRowRenderer?.title?.simpleText === 'Artist');

    const songName = song?.metadataRowRenderer?.contents?.[0]?.simpleText;
    const artistName = artist?.metadataRowRenderer?.contents?.[0]?.runs?.[0]?.text;

    if (songName && artistName) {
      const {TRACK} = await searchAlternative(artistName, songName, 1);
      if (TRACK.data[0]) {
        return TRACK.data[0];
      }
    }
  }

  if (playerResponse?.videoDetails?.title) {
    return await searchTrackByTitle(playerResponse.videoDetails.title);
  }

  return undefined;
};

/**
 * Convert a youtube video to track by video id
 * @param {String} id - video id
 */
export const track2deezer = async (id: string) => {
  const track = await getTrack(id);
  if (track) {
    return track;
  }

  throw new Error('No track found for youtube video ' + id);
};
