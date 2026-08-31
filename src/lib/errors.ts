/** The raw `error` object a Deezer gateway response carries. */
export type DeezerErrorPayload = Record<string, unknown>;

/** Gateway error keys where retrying (after a token refresh / re-auth) can help. */
const RETRYABLE_KEYS = new Set(['NEED_API_AUTH_REQUIRED', 'GATEWAY_ERROR', 'VALID_TOKEN_REQUIRED']);

/**
 * A structured error from the Deezer gateway or media API — replaces the old
 * `new Error(Object.entries(error).join(', '))`. Carries the numeric `code`, the
 * gateway error `keys`, a `retryable` hint, and the raw `payload`.
 *
 * The `message` is still human-readable (`"VALID_TOKEN_REQUIRED: …"`), so code
 * that only reads `err.message` keeps working — but prefer `err.code` /
 * `err.keys` / `err.retryable`.
 */
export class DeezerError extends Error {
  /** `error.code` when Deezer sent a numeric one */
  readonly code?: number;
  /** the gateway error keys, e.g. `['VALID_TOKEN_REQUIRED']`, `['DATA_ERROR']` */
  readonly keys: string[];
  /** whether a retry could plausibly succeed */
  readonly retryable: boolean;
  /** the raw error payload */
  readonly payload: DeezerErrorPayload;

  constructor(payload: DeezerErrorPayload | null | undefined, opts: {retryable?: boolean; message?: string} = {}) {
    const p: DeezerErrorPayload = payload && typeof payload === 'object' ? payload : {};
    const keys = Object.keys(p);
    const rawCode = (p as {code?: unknown}).code;
    const code = typeof rawCode === 'number' ? rawCode : undefined;

    super(opts.message ?? describe(p, keys));
    this.name = 'DeezerError';
    this.code = code;
    this.keys = keys;
    this.payload = p;
    this.retryable = opts.retryable ?? isRetryable(code, keys);
  }

  /** Whether a `code` / key set is worth retrying. */
  static retryable(code: number | undefined, keys: string[]): boolean {
    return isRetryable(code, keys);
  }
}

const describe = (payload: DeezerErrorPayload, keys: string[]): string => {
  if (!keys.length) return 'Deezer request failed';
  return keys.map((k) => `${k}: ${String(payload[k])}`).join(', ');
};

const isRetryable = (code: number | undefined, keys: string[]): boolean => {
  if (code === 4) return true; // Deezer's transient "quota exceeded"
  return keys.some((k) => RETRYABLE_KEYS.has(k));
};
