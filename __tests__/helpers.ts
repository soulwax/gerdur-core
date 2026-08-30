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
