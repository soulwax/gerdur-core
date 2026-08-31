import type {searchResultAlbum, searchResultArtist, searchResultPlaylist, searchResultTrack} from './search';

/** The `{data, total, next?, prev?}` envelope every paginated public-API list uses. */
export interface publicApiList<T> {
  data: T[];
  total?: number;
  /** absolute URL of the next page, when there is one */
  next?: string;
  prev?: string;
}

export interface chartTrack extends searchResultTrack {
  /** 1-based position in the chart */
  position: number;
}

export interface chartArtist extends searchResultArtist {
  position: number;
}

export interface chartAlbum extends searchResultAlbum {
  position: number;
}

export interface chartPlaylist extends searchResultPlaylist {
  position: number;
}

export interface chartPodcast {
  id: number;
  title: string;
  description?: string;
  available?: boolean;
  fans?: number;
  link?: string;
  share?: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  position: number;
  type: 'podcast';
}

/** `/chart/{genreId}` — the five ranked lists Deezer publishes per genre (`0` = all genres). */
export interface chartType {
  tracks: publicApiList<chartTrack>;
  albums: publicApiList<chartAlbum>;
  artists: publicApiList<chartArtist>;
  playlists: publicApiList<chartPlaylist>;
  podcasts: publicApiList<chartPodcast>;
}

export interface genreType {
  id: number;
  name: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  type: 'genre';
}

export interface editorialType {
  id: number;
  name: string;
  picture: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  type: 'editorial';
}

/** An album from `/artist/{id}/albums` — the artist's own discography, public-API shape. */
export interface artistAlbumResult {
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
  fans?: number;
  release_date: string;
  record_type: string;
  tracklist: string;
  explicit_lyrics: boolean;
  type: 'album';
}
