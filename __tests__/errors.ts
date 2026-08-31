import test from 'ava';
import {DeezerError} from '../src/lib/errors';
import {RETRY_POLICY} from '../src/lib/request';

test('DeezerError — parses a gateway error payload', (t) => {
  const err = new DeezerError({VALID_TOKEN_REQUIRED: 'Invalid CSRF token'});
  t.is(err.name, 'DeezerError');
  t.true(err instanceof Error);
  t.deepEqual(err.keys, ['VALID_TOKEN_REQUIRED']);
  t.is(err.code, undefined);
  t.true(err.retryable);
  t.is(err.message, 'VALID_TOKEN_REQUIRED: Invalid CSRF token');
});

test('DeezerError — numeric code 4 is retryable, DATA_ERROR is not', (t) => {
  t.true(new DeezerError({code: 4, message: 'Quota'}).retryable);
  t.false(new DeezerError({DATA_ERROR: 'No song data'}).retryable);
  t.is(new DeezerError({code: 800, message: 'x'}).code, 800);
});

test('DeezerError — tolerates a missing / non-object payload', (t) => {
  const err = new DeezerError(undefined);
  t.deepEqual(err.keys, []);
  t.is(err.message, 'Deezer request failed');
  t.false(err.retryable);
});

test('DeezerError.retryable static helper', (t) => {
  t.true(DeezerError.retryable(4, []));
  t.true(DeezerError.retryable(undefined, ['GATEWAY_ERROR']));
  t.false(DeezerError.retryable(100, ['DATA_ERROR']));
});

test('RETRY_POLICY has finite caps and a deadline', (t) => {
  t.true(RETRY_POLICY.code4Attempts > 0 && Number.isFinite(RETRY_POLICY.code4Attempts));
  t.true(RETRY_POLICY.authReinits > 0 && Number.isFinite(RETRY_POLICY.authReinits));
  t.true(RETRY_POLICY.deadlineMs >= 1000);
});
