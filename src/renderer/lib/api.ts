import type { HearlogueApi, BridgeError } from '@preload/api-types';
import type { AppError } from '@shared/types/common';

/**
 * Access to the preload bridge.
 *
 * The renderer never touches `window.hearlogue` directly; going through here
 * means a missing bridge (a stray browser tab, a test harness) fails with a
 * clear message instead of `undefined is not a function`, and every error that
 * comes back is a structured `AppError` the UI can translate.
 */

export function api(): HearlogueApi {
  const bridge = window.hearlogue;
  if (!bridge) {
    throw new Error('HEARLOGUE bridge unavailable — the renderer is running outside Electron.');
  }
  return bridge;
}

/**
 * The preload encodes failures into the error message, because the context
 * bridge re-creates thrown errors in this world and drops every property except
 * `name`, `message` and `stack`. See `preload/preload.ts` for the other half.
 */
const BRIDGE_ERROR_PREFIX = 'HEARLOGUE_ERROR:';

export function isBridgeError(error: unknown): error is BridgeError {
  return error instanceof Error && error.message.startsWith(BRIDGE_ERROR_PREFIX);
}

export function toAppError(error: unknown): AppError {
  // Same-world throw (unit tests, or a direct call): the payload is still attached.
  if (error instanceof Error && typeof (error as BridgeError).appError?.code === 'string') {
    return (error as BridgeError).appError;
  }

  if (isBridgeError(error)) {
    try {
      const parsed = JSON.parse(error.message.slice(BRIDGE_ERROR_PREFIX.length)) as AppError;
      if (typeof parsed?.code === 'string' && typeof parsed?.messageKey === 'string') {
        return parsed;
      }
    } catch {
      /* fall through to the generic error below */
    }
  }

  return { code: 'UNKNOWN', messageKey: 'error.unknown' };
}

/** Opens a Spotify URI or URL, swallowing the "blocked" case quietly. */
export async function openSpotify(uri: string | null): Promise<boolean> {
  if (!uri) return false;
  try {
    await api().system.openExternal({ url: uri });
    return true;
  } catch {
    return false;
  }
}
