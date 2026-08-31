import type {albumType, albumTypeMinimal} from './album';
import type {artistInfoTypeMinimal, artistType} from './artist';
import type {playlistInfo, playlistInfoMinimal} from './playlist';
import type {trackType} from './tracks';
import type {profileTypeMinimal} from './profile';
import type {channelSearchType} from './channel';
import type {radioType} from './radio';
import type {showEpisodeType} from './show';

interface searchTypeCommon {
  count: number;
  total: number;
  filtered_count: number;
  filtered_items: number[];
  next: number;
}

interface albumSearchType extends searchTypeCommon {
  data: albumTypeMinimal[];
}

interface artistSearchType extends searchTypeCommon {
  data: artistInfoTypeMinimal[];
}

interface playlistSearchType extends searchTypeCommon {
  data: playlistInfoMinimal[];
}

interface trackSearchType extends searchTypeCommon {
  data: trackType[];
}

interface profileSearchType extends searchTypeCommon {
  data: profileTypeMinimal[];
}

interface radioSearchType extends searchTypeCommon {
  data: radioType[];
}

interface liveSearchType extends searchTypeCommon {
  data: unknown[];
}

interface showSearchType extends searchTypeCommon {
  data: showEpisodeType[];
}

export interface discographyType {
  data: albumType[];
  count: number; // 109,
  total: number; // 109,
  cache_version: number; // 2,
  filtered_count: number; // 0,
  art_id: number; // 1424821,
  start: number; // 0,
  nb: number; // 500
}

/**
 * Deezer's advanced search operators. Compose these into one query string with
 * `buildAdvancedQuery()` — e.g. `{artist: 'daft punk', durMin: 200}` becomes
 * `artist:"daft punk" dur_min:200`.
 *
 * Deezer applies these as ranking hints, not hard filters, and honours `track:`
 * only intermittently on their side — this type just mirrors the syntax they
 * document.
 */
export interface advancedSearchFilters {
  /** free-text terms, emitted first and bare */
  query?: string;
  artist?: string;
  album?: string;
  track?: string;
  label?: string;
  /** minimum duration, seconds */
  durMin?: number;
  /** maximum duration, seconds */
  durMax?: number;
  /** minimum beats-per-minute */
  bpmMin?: number;
  /** maximum beats-per-minute */
  bpmMax?: number;
}

export type searchOrder =
  | 'RANKING'
  | 'TRACK_ASC'
  | 'TRACK_DESC'
  | 'ARTIST_ASC'
  | 'ARTIST_DESC'
  | 'ALBUM_ASC'
  | 'ALBUM_DESC'
  | 'RATING_ASC'
  | 'RATING_DESC'
  | 'DURATION_ASC'
  | 'DURATION_DESC';

export type searchEntity = 'track' | 'album' | 'artist' | 'playlist' | 'user' | 'radio' | 'podcast';

export interface publicApiSearchOptions {
  /** which index to hit — `track` (default), `album`, `artist`, `playlist`, `user`, `radio`, `podcast` */
  type?: searchEntity;
  order?: searchOrder;
  /** send Deezer's `strict=on` — disables the fuzzy fallback */
  strict?: boolean;
  /** page size; Deezer caps this near 100 */
  limit?: number;
  /** offset into the result set */
  index?: number;
}

export interface publicApiSearchResponse<T> {
  data: T[];
  total: number;
  /** absolute URL of the next page, when there is one */
  next?: string;
  prev?: string;
}

interface searchArtistRef {
  id: number;
  name: string;
  link?: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  tracklist?: string;
  type: 'artist';
}

interface searchAlbumRef {
  id: number;
  title: string;
  cover?: string;
  cover_small?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  md5_image?: string;
  tracklist?: string;
  type: 'album';
}

export interface searchResultTrack {
  id: number;
  readable: boolean;
  title: string;
  title_short: string;
  title_version?: string;
  link: string;
  duration: number;
  rank: number;
  explicit_lyrics: boolean;
  explicit_content_lyrics: number;
  explicit_content_cover: number;
  preview: string;
  md5_image: string;
  isrc?: string;
  artist: searchArtistRef;
  album: searchAlbumRef;
  type: 'track';
}

export interface searchResultAlbum {
  id: number;
  title: string;
  link: string;
  cover: string;
  cover_small?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  md5_image: string;
  genre_id: number;
  nb_tracks: number;
  record_type: string;
  explicit_lyrics: boolean;
  artist: searchArtistRef;
  type: 'album';
}

export interface searchResultArtist {
  id: number;
  name: string;
  link: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  nb_album: number;
  nb_fan: number;
  radio: boolean;
  tracklist: string;
  type: 'artist';
}

export interface searchResultPlaylist {
  id: number;
  title: string;
  public: boolean;
  nb_tracks: number;
  link: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  checksum?: string;
  tracklist: string;
  creation_date?: string;
  user?: {id: number; name: string; tracklist?: string; type: 'user'};
  type: 'playlist';
}

/**
 * `deezer.suggest` — lightweight autocomplete off the internal gateway. Each
 * per-type array is gw-shaped (uppercase keys), same as `searchMusic`'s.
 */
export interface suggestResult {
  QUERY: string;
  TOP_RESULT: unknown[];
  ORDER: string[];
  ALBUM?: albumTypeMinimal[];
  ARTIST?: artistInfoTypeMinimal[];
  TRACK?: trackType[];
  PLAYLIST?: playlistInfoMinimal[];
  SHOW?: unknown[];
  RADIO?: radioType[];
}

export interface searchType {
  QUERY: string; //;
  FUZZINNESS: boolean;
  AUTOCORRECT: boolean;
  TOP_RESULT: [albumType | artistType | trackType | playlistInfo | artistType | unknown] | [];
  ORDER: [
    'TOP_RESULT',
    'TRACK',
    'PLAYLIST',
    'ALBUM',
    'ARTIST',
    'LIVESTREAM',
    'EPISODE',
    'SHOW',
    'CHANNEL',
    'RADIO',
    'USER',
    'LYRICS',
  ];
  ALBUM: albumSearchType;
  ARTIST: artistSearchType;
  TRACK: trackSearchType;
  PLAYLIST: playlistSearchType;
  RADIO: radioSearchType;
  SHOW: showSearchType;
  USER: profileSearchType;
  LIVESTREAM: liveSearchType;
  CHANNEL: channelSearchType;
}
