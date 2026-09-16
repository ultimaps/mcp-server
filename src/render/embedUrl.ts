/**
 * The embeddable keyless image URL: the same spec as
 * `GET /v1/renders?spec=…`. A bonus, never a dependency — offered only when it
 * is actually shareable.
 */
import { isRecord } from '../guards.js';

/** Gate on what email clients and Markdown renderers survive, not the API's 6 KB cap. */
export const EMBED_URL_MAX_LENGTH = 2000;
/** Keyless tier caps: width, explicit height (derived heights are exempt), scale. */
export const KEYLESS_MAX_SIDE = 1600;
export const DEFAULT_WIDTH = 1200;

export function keylessEmbedUrl(apiUrl: string, args: Record<string, unknown>, hasApiKey: boolean): string | undefined {
  // The GET twin always renders keyless: a keyed caller's clean image would
  // pair with a watermarked URL, so it is suppressed rather than mislabelled.
  if (hasApiKey || args.dryRun === true) return undefined;

  const output = isRecord(args.output) ? args.output : {};
  if ((output.format ?? 'png') !== 'png') return undefined;
  const width = output.width ?? DEFAULT_WIDTH;
  if (typeof width !== 'number' || width > KEYLESS_MAX_SIDE) return undefined;
  if (output.height !== undefined && (typeof output.height !== 'number' || output.height > KEYLESS_MAX_SIDE)) {
    return undefined;
  }
  if (output.scale !== undefined && output.scale !== 1) return undefined;

  const url = `${apiUrl}/v1/renders?spec=${encodeURIComponent(JSON.stringify(args))}`;
  return url.length <= EMBED_URL_MAX_LENGTH ? url : undefined;
}
