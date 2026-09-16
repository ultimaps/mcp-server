/**
 * Renders too large to inline go to disk: no
 * resampling, no second render on the caller's behalf.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SavedFile {
  path: string;
  bytes: number;
}

export function safeFileStem(text: string): string {
  const stem = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return stem || 'map';
}

export async function saveRender(options: {
  bytes: Buffer;
  extension: 'png' | 'svg';
  stem: string;
  renderId: string | null;
  directory?: string;
}): Promise<SavedFile> {
  const directory = options.directory ?? join(tmpdir(), 'ultimaps-mcp');
  await mkdir(directory, { recursive: true });
  const suffix = options.renderId ? safeFileStem(options.renderId).slice(0, 8) : String(Date.now());
  const path = join(directory, `${safeFileStem(options.stem)}-${suffix}.${options.extension}`);
  await writeFile(path, options.bytes);
  return { path, bytes: options.bytes.length };
}
