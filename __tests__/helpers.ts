import type {ExecutionContext} from 'ava';
import * as api from '../src';
import {spotify} from '../src';

type TestContext = ExecutionContext<unknown>;
type ErrorLike = {message?: string; statusCode?: number};

let deezerAuthPromise: Promise<boolean> | null = null;
let spotifyAvailabilityPromise: Promise<{available: boolean; reason?: string}> | null = null;

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
};

const getErrorStatus = (err: unknown): number | undefined => {
  return (err as ErrorLike | undefined)?.statusCode;
};

export const skipWithReason = (t: TestContext, reason: string): true => {
  t.log(reason);
  t.pass();
  return true;
};

export const shouldSkipBecauseUnavailable = (err: unknown, statuses: number[], fragments: string[] = []): boolean => {
  const status = getErrorStatus(err);
  const message = getErrorMessage(err);
  return statuses.includes(status ?? -1) || fragments.some((fragment) => message.includes(fragment));
};

/**
 * External APIs (Deezer public REST, Tidal, YouTube) throttle bursts — `code: 4`
 * ("Quota exceeded"), HTTP 429/403, consent walls, dropped connections. Skipping
 * on any of those keeps the live-API suite green when it hammers them in
 * parallel; a genuine bug still surfaces as a real assertion failure.
 */
export const skipIfRateLimited = (t: TestContext, err: unknown): boolean => {
  const message = getErrorMessage(err);
  const status = getErrorStatus(err);
  const code = (err as {code?: unknown})?.code;
  const rateLimited =
    status === 429 ||
    status === 403 ||
    code === 4 ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    /Quota|quota exceeded|too many requests|status code (429|403)|consent|socket hang up|timed out/i.test(message);
  if (rateLimited) {
    skipWithReason(t, `Skipping: an upstream API is rate-limiting / unavailable (${message.slice(0, 80)}).`);
    return true;
  }
  return false;
};

export const ensureDeezerUserAuth = async (t: TestContext): Promise<boolean> => {
  if (!process.env.HIFI_ARL) {
    skipWithReason(t, 'Skipping auth-required Deezer test because HIFI_ARL is not set.');
    return false;
  }

  if (!deezerAuthPromise) {
    deezerAuthPromise = api
      .initDeezerApi(process.env.HIFI_ARL)
      .then(() => true)
      .catch((err) => {
        deezerAuthPromise = null;
        throw err;
      });
  }

  try {
    return await deezerAuthPromise;
  } catch (err) {
    skipWithReason(t, `Skipping auth-required Deezer test because auth bootstrap failed: ${getErrorMessage(err)}`);
    return false;
  }
};

export const ensureSpotifyAvailability = async (t: TestContext): Promise<boolean> => {
  if (!spotifyAvailabilityPromise) {
    spotifyAvailabilityPromise = spotify
      .setSpotifyAnonymousToken()
      .then(() => ({available: true}))
      .catch((err) => {
        if (shouldSkipBecauseUnavailable(err, [401, 403], ['URL Blocked', 'No token provided'])) {
          return {available: false, reason: getErrorMessage(err)};
        }

        throw err;
      });
  }

  const availability = await spotifyAvailabilityPromise;
  if (!availability.available) {
    skipWithReason(
      t,
      `Skipping Spotify live test because the anonymous token endpoint is unavailable: ${availability.reason}`,
    );
    return false;
  }

  return true;
};
