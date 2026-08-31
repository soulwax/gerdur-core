import test from 'ava';
import * as api from '../src';
import {skipIfRateLimited, skipWithReason} from './helpers';

api.configureMusicBrainz({
  userAgent: 'gerdur-core-tests/0 (+https://github.com/soulwax/gerdur-core)',
  minIntervalMs: 1300,
});

test.serial('MusicBrainz — recording by ISRC', async (t) => {
  let rec;
  try {
    rec = await api.lookupRecordingByISRC('GBDUW0000059');
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
    return;
  }
  if (!rec) {
    skipWithReason(t, 'MusicBrainz returned no match (transient).');
    return;
  }

  t.is(rec.title, 'Harder, Better, Faster, Stronger');
  t.is(rec.artist, 'Daft Punk');
  t.regex(rec.mbid, /^[0-9a-f-]{36}$/);
  t.true(rec.isrcs.includes('GBDUW0000059'));
  t.true(typeof rec.lengthMs === 'number' && rec.lengthMs > 0);
  t.true(rec.releases.length > 0);
  t.regex(rec.releases[0].releaseGroupMbid ?? '', /^[0-9a-f-]{36}$/);
});

test.serial('MusicBrainz — a well-formed ISRC with no match resolves null', async (t) => {
  try {
    t.is(await api.lookupRecordingByISRC('US1234567890'), null);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test.serial('Cover Art Archive — best front cover, and null for a missing MBID', async (t) => {
  try {
    // Daft Punk — "Discovery" release-group
    const url = await api.getBestCoverArtUrl('4a685ee7-6d6b-3e33-9dae-e7c6dbcbb17c', {minSize: 500});
    if (url) {
      t.regex(url, /^https:\/\/(coverartarchive\.org|.*archive\.org)\//);
    } else {
      skipWithReason(t, 'no approved front cover for that release-group right now');
    }

    t.is(await api.getCoverArt('00000000-0000-0000-0000-000000000000'), null);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});

test.serial('getCoverArtByISRC — picks a real cover, not the first promo release', async (t) => {
  try {
    const url = await api.getCoverArtByISRC('GBDUW0000059', {minSize: 500});
    // this ISRC's first MB release is a promo comp with no art; the ranked walk
    // must fall through to an official album that has one
    if (url) {
      t.regex(url, /^https:\/\/(coverartarchive\.org|.*archive\.org)\//);
    } else {
      skipWithReason(t, 'no CAA art for any of the top release-groups right now');
    }
    t.is(await api.getCoverArtByISRC('US1234567890'), null);
  } catch (err) {
    if (!skipIfRateLimited(t, err)) throw err;
  }
});
