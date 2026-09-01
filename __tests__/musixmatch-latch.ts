import test from 'ava';
import {configureMusixmatch, musixmatchStatus} from '../src';

/**
 * The latch's state machine, offline. The tripping itself needs the network (and
 * is measured in the changelog); what matters to pin here is that the controls
 * behave and that nothing latches without being told to.
 */

test.serial('status reports availability and the threshold', (t) => {
  configureMusixmatch({enabled: true});
  const s = musixmatchStatus();
  t.true(s.available);
  t.is(s.consecutiveFailures, 0);
  t.is(typeof s.maxFailures, 'number');
  t.true(s.maxFailures > 0);
});

test.serial('it can be switched off and back on', (t) => {
  configureMusixmatch({enabled: false});
  t.false(musixmatchStatus().available, 'disabled on request');

  configureMusixmatch({enabled: true});
  t.true(musixmatchStatus().available, 're-enabled');
  t.is(musixmatchStatus().consecutiveFailures, 0, 're-enabling clears the failure count');
});

test.serial('the threshold is configurable and ignores nonsense', (t) => {
  configureMusixmatch({maxFailures: 7});
  t.is(musixmatchStatus().maxFailures, 7);

  configureMusixmatch({maxFailures: 0});
  t.is(musixmatchStatus().maxFailures, 7, 'zero is rejected — it would latch instantly');

  configureMusixmatch({maxFailures: -1});
  t.is(musixmatchStatus().maxFailures, 7, 'negatives are rejected');

  configureMusixmatch({maxFailures: 3, enabled: true}); // restore the default
  t.is(musixmatchStatus().maxFailures, 3);
});

test.serial('an empty call changes nothing', (t) => {
  configureMusixmatch({maxFailures: 5, enabled: true});
  configureMusixmatch();
  t.deepEqual(musixmatchStatus(), {available: true, consecutiveFailures: 0, maxFailures: 5});
  configureMusixmatch({maxFailures: 3, enabled: true});
});
