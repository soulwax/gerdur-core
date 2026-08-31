import type {searchResultTrack, searchResultArtist} from './search';

export interface userType {
  USER_ID: string;
  EMAIL: string;
  FIRSTNAME: string;
  LASTNAME: string;
  BIRTHDAY: string;
  BLOG_NAME: string;
  SEX: string;
  ADDRESS?: string;
  CITY?: string;
  ZIP?: string;
  COUNTRY: string;
  LANG: string;
  PHONE?: string;
  __TYPE__: 'user';
}

// ─── Public-REST `/user/{id}/…` shapes for library + Flow ─────────────────────

/** A favourite track from `/user/{id}/tracks` — public-API shape, plus `time_add`. */
export interface userFavoriteTrack extends searchResultTrack {
  /** unix timestamp the track was added to favourites */
  time_add?: number;
}

export interface userFavoriteAlbum {
  id: number;
  title: string;
  link: string;
  cover: string;
  cover_small?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  md5_image: string;
  nb_tracks: number;
  release_date: string;
  record_type: string;
  available: boolean;
  tracklist: string;
  explicit_lyrics: boolean;
  time_add?: number;
  artist: searchResultArtist | {id: number; name: string; tracklist?: string; type: 'artist'};
  type: 'album';
}

export interface userFavoriteArtist extends searchResultArtist {
  time_add?: number;
}

export interface userPlaylistResult {
  id: number;
  title: string;
  duration: number;
  public: boolean;
  is_loved_track: boolean;
  collaborative: boolean;
  nb_tracks: number;
  fans: number;
  link: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  checksum: string;
  tracklist: string;
  creation_date?: string;
  time_add?: number;
  time_mod?: number;
  creator?: {id: number; name: string; tracklist?: string; type: 'user'};
  type: 'playlist';
}

export interface radioResult {
  id: number;
  title: string;
  description?: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  md5_image?: string;
  tracklist: string;
  type: 'radio';
}

export interface radioGenre {
  id: number;
  title: string;
  radios: radioResult[];
}
