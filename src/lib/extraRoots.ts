import { formatInvokeError } from "./errors";
import { ExtraRoots } from "./types";

export { formatInvokeError };

/** Patch produced from Settings `getExtraRoots` Promise.allSettled result. */
export type ExtraRootsLoadPatch = {
  /** Present only when the fetch succeeded — omit so callers keep the previous list. */
  extraRoots?: ExtraRoots;
  extraRootsError: string | null;
};

/**
 * A rejected extra-roots fetch must surface an error rather than looking like
 * "no directories configured". Success clears the error and replaces the list.
 */
export function extraRootsLoadPatch(
  result: PromiseSettledResult<ExtraRoots>,
): ExtraRootsLoadPatch {
  if (result.status === "fulfilled") {
    return { extraRoots: result.value, extraRootsError: null };
  }
  return { extraRootsError: formatInvokeError(result.reason) };
}
