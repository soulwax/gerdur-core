import {request} from './request';
import {getShowInfo} from './api';
import type {publicApiList, showEpisodeType} from '../types';

/**
 * One podcast episode (`episode.getData`). Carries `EPISODE_DIRECT_STREAM_URL`
 * (a plain MP3 — no licence, no decryption) plus `MD5_ORIGIN` / `FILESIZE_MP3_*`
 * / `TRACK_TOKEN` for the licensed stream.
 */
export const getEpisode = (episodeId: string): Promise<showEpisodeType> =>
  request({episode_id: episodeId}, 'episode.getData');

/**
 * A page of a show's episodes, newest first — a thin view over `getShowInfo`'s
 * `EPISODES` block.
 *
 * @param showId `SHOW_ID`
 * @param nb     page size (default 25)
 * @param start  offset
 */
export const getShowEpisodes = async (showId: string, nb = 25, start = 0): Promise<publicApiList<showEpisodeType>> => {
  const {EPISODES} = await getShowInfo(showId, nb, start);
  return {data: EPISODES.data, total: EPISODES.total};
};
