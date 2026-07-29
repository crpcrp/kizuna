import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the repository root. */
export const REPO_ROOT = join(TEST_DIR, '..')

/** Absolute path to `test/fixtures`, independent of the importing test's depth. */
export const FIXTURES_DIR = join(TEST_DIR, 'fixtures')

/** Resolve a path inside `test/fixtures`, e.g. `fixture('ffprobe-mkv.json')`. */
export function fixture(...segments: string[]): string {
  return join(FIXTURES_DIR, ...segments)
}
