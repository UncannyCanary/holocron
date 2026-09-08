import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file sits at apps/api/src/paths.ts (or apps/api/dist/paths.js once
// built), always four levels under the repo root, so this resolves the same
// way whether the app runs from source or from a build.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

// Uploaded files and rendered page images. Defaults to the Docker volume;
// override with DATA_DIR for a local run outside Docker. A relative DATA_DIR
// is taken from the repo root, so the API and the worker agree on the path
// whatever folder each was started from.
export function dataPath(...segments: string[]): string {
  const base = path.resolve(REPO_ROOT, process.env.DATA_DIR ?? '/data');
  return path.join(base, ...segments);
}

// The sample documents checked into samples/. Left out of the Docker image,
// so a container needs it mounted at REPO_ROOT/samples, matching where it
// already sits in a local checkout.
export function samplesPath(...segments: string[]): string {
  return path.join(REPO_ROOT, 'samples', ...segments);
}
