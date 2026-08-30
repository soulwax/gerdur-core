import crypto from 'crypto';
import type {trackType} from '../types';

const md5 = (data: string, type: crypto.Encoding = 'ascii') => {
  const md5sum = crypto.createHash('md5');
  md5sum.update(data.toString(), type);
  return md5sum.digest('hex');
};

export const getSongFileName = ({MD5_ORIGIN, SNG_ID, MEDIA_VERSION}: trackType, quality: number) => {
  if (!MD5_ORIGIN) {
    throw new Error(`Missing MD5_ORIGIN for track ${SNG_ID}`);
  }

  const step1 = [MD5_ORIGIN, quality, SNG_ID, MEDIA_VERSION].join('¤');

  let step2 = md5(step1) + '¤' + step1 + '¤';
  while (step2.length % 16 > 0) step2 += ' ';

  return crypto.createCipheriv('aes-128-ecb', 'jo6aey6haid2Teih', '').update(step2, 'ascii', 'hex');
};

const getBlowfishKey = (trackId: string) => {
  const SECRET = 'g4el58wc' + '0zvf9na1';
  const idMd5 = md5(trackId);
  let bfKey = '';
  for (let i = 0; i < 16; i++) {
    bfKey += String.fromCharCode(idMd5.charCodeAt(i) ^ idMd5.charCodeAt(i + 16) ^ SECRET.charCodeAt(i));
  }
  return bfKey;
};

const decryptChunk = (chunk: Buffer, blowFishKey: string) => {
  const cipher = crypto.createDecipheriv('bf-cbc', blowFishKey, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(chunk), cipher.final()]);
};

/**
 *
 * @param source Downloaded song from `getTrackDownloadUrl`
 * @param trackId Song ID as string
 */
export const decryptDownload = (source: Buffer, trackId: string) => {
  const chunkSize = 2048;
  const blowFishKey = getBlowfishKey(trackId);
  let chunkIndex = 0;
  let position = 0;
  const destBuffer = Buffer.alloc(source.length);

  while (position < source.length) {
    const currentChunkSize = Math.min(chunkSize, source.length - position);
    const sourceChunk = source.subarray(position, position + currentChunkSize);

    if (chunkIndex % 3 > 0 || currentChunkSize < chunkSize) {
      sourceChunk.copy(destBuffer, position);
    } else {
      decryptChunk(sourceChunk, blowFishKey).copy(destBuffer, position);
    }

    position += currentChunkSize;
    chunkIndex++;
  }

  return destBuffer;
};
