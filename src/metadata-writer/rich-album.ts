import {getAlbumInfo, getAlbumInfoPublicApi} from '../api';
import type {albumType, albumTypePublicApi} from '../types';

export interface RichAlbum {
  id: string;
  title: string;
  albumArtist: string;
  /** © line — from gw `COPYRIGHT`, falls back to `PRODUCER_LINE` */
  copyright?: string;
  /** ℗ line — only set when it differs from `copyright` */
  producerLine?: string;
  /** best available release date, YYYY-MM-DD */
  releaseDate?: string;
  /** ORIGINAL_RELEASE_DATE — the true first release; only when it differs from releaseDate */
  originalDate?: string;
  upc?: string;
  label?: string;
  labelId?: string;
  genres: string[];
  /** album | single | ep | compile | live … */
  recordType?: string;
  isCompilation: boolean;
  isLive: boolean;
  trackTotal?: number;
  discTotal?: number;
  fans?: number;
  /** the two raw payloads, for callers that want more */
  gw?: albumType;
  publicApi?: albumTypePublicApi;
}

const pickDate = (s?: string): string | undefined =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !/^0000/.test(s) ? s : undefined;

/**
 * One merged album view from the two endpoints that actually carry the good
 * fields: `album.getData` (gw — ©/℗, original release date, disc total,
 * subtypes) and the public `/album/` (label, genres, record type). Both calls
 * are memoised and in-flight-coalesced by the api layer, so calling this once
 * per track of an album costs a single network round-trip for the whole album.
 *
 * The public endpoint 404s for some small-label albums; that path is optional
 * and the gw data still comes through.
 */
export const getRichAlbum = async (albId: string): Promise<RichAlbum> => {
  const [gwResult, publicResult] = await Promise.allSettled([getAlbumInfo(albId), getAlbumInfoPublicApi(albId)]);

  const gw = gwResult.status === 'fulfilled' ? gwResult.value : undefined;
  const pub = publicResult.status === 'fulfilled' ? publicResult.value : undefined;

  const copyright = (gw?.COPYRIGHT || gw?.PRODUCER_LINE || '').trim() || undefined;
  const producerLineRaw = (gw?.PRODUCER_LINE || '').trim() || undefined;
  const producerLine = producerLineRaw && producerLineRaw !== copyright ? producerLineRaw : undefined;

  const releaseDate =
    pickDate(gw?.DIGITAL_RELEASE_DATE) ||
    pickDate(pub?.release_date) ||
    pickDate(gw?.PHYSICAL_RELEASE_DATE) ||
    pickDate(gw?.ORIGINAL_RELEASE_DATE);
  const originalRaw = pickDate(gw?.ORIGINAL_RELEASE_DATE);
  const originalDate = originalRaw && originalRaw !== releaseDate ? originalRaw : undefined;

  const recordType = pub?.record_type || undefined;

  return {
    id: albId,
    title: gw?.ALB_TITLE || pub?.title || '',
    albumArtist: gw?.ART_NAME || pub?.artist?.name || '',
    copyright,
    producerLine,
    releaseDate,
    originalDate,
    upc: gw?.UPC || pub?.upc || undefined,
    label: pub?.label || undefined,
    labelId: (gw as any)?.LABEL_ID || undefined,
    genres: (pub?.genres?.data || []).map((g) => g.name).filter(Boolean),
    recordType,
    isCompilation: Boolean(gw?.SUBTYPES?.isCompilation) || recordType === 'compile',
    isLive: Boolean(gw?.SUBTYPES?.isLive),
    trackTotal: gw?.NUMBER_TRACK ? Number(gw.NUMBER_TRACK) : pub?.nb_tracks,
    discTotal: gw?.NUMBER_DISK ? Number(gw.NUMBER_DISK) : undefined,
    fans: pub?.fans ?? gw?.NB_FAN,
    gw,
    publicApi: pub,
  };
};
