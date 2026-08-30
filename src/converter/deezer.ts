import delay from 'delay';
import {getAlbumInfo, getAlbumTracks, getTrackInfo} from '../api';
import {HttpClient} from '../lib/http';
import type {albumType, trackType} from '../types';

const instance = new HttpClient({baseURL: 'https://api.deezer.com/', timeout: 15000});

type DeezerLookup = {
  error?: {
    code?: number;
  };
  id: string;
};

const requestLookup = async (path: string): Promise<DeezerLookup> => {
  const {data} = await instance.get<DeezerLookup>(path);
  if (data.error && data.error.code === 4) {
    await delay.range(1000, 1500);
    return await requestLookup(path);
  }

  return data;
};

export const isrc2deezer = async (name: string, isrc?: string) => {
  if (!isrc) {
    throw new Error('ISRC code not found for ' + name);
  }

  const data = await requestLookup('track/isrc:' + isrc);
  if (data.error) {
    throw new Error(`No match on deezer for ${name} (ISRC: ${isrc})`);
  }

  return await getTrackInfo(data.id);
};

export const upc2deezer = async (name: string, upc?: string): Promise<[albumType, trackType[]]> => {
  if (!upc) {
    throw new Error('UPC code not found for ' + name);
  } else if (upc.length > 12 && upc.startsWith('0')) {
    upc = upc.slice(-12);
  }

  const data = await requestLookup('album/upc:' + upc);
  if (data.error) {
    throw new Error(`No match on deezer for ${name} (UPC: ${upc})`);
  }

  const albumInfo = await getAlbumInfo(data.id);
  const albumTracks = await getAlbumTracks(data.id);
  return [albumInfo, albumTracks.data];
};
