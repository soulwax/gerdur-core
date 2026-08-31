import test from 'ava';
import * as api from '../../src';
import {skipIfRateLimited} from '../helpers';

// Harder, Better, Faster, Stronger by Daft Punk
const SNG_TITLE = 'Harder, Better, Faster, Stronger';
const ISRC = 'GBDUW0000059';

// Discovery by Daft Punk
const ALB_TITLE = 'Discovery';
const UPC = '724384960650';

test.serial('GET TRACK ISRC', async (t) => {
  let response;
  try {
    response = await api.isrc2deezer(SNG_TITLE, ISRC);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
    return;
  }

  t.is(response.SNG_TITLE, SNG_TITLE);
  t.is(response.ISRC, ISRC);
  t.truthy(response.TRACK_TOKEN);
  t.is(response.__TYPE__, 'song');
});

test.serial('GET ALBUM UPC', async (t) => {
  let result: Awaited<ReturnType<typeof api.upc2deezer>>;
  try {
    result = await api.upc2deezer(ALB_TITLE, UPC);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
    return;
  }
  const [album, tracks] = result;

  t.is(album.ALB_TITLE, ALB_TITLE);
  t.is(album.UPC, UPC);
  t.is(album.__TYPE__, 'album');

  t.is(Number(album.NUMBER_TRACK), tracks.length);
});
