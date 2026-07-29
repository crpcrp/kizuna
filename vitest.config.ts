import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests run in plain Node (no Electron) and only cover pure/shared logic.
// Electron boundaries get harnessed later, per AGENTS.md.
//
// `test/` mirrors `src/`: the test for `src/main/media/ffprobe.ts` lives at
// `test/main/media/ffprobe.test.ts`. Where one source file needs more than one
// test file, they share the source basename as a prefix, e.g.
// `ffprobe.test.ts` + `ffprobe.enumerate.test.ts`.
export default defineConfig({
  resolve: {
    // Keep in sync with `compilerOptions.paths` in tsconfig.json.
    alias: {
      '@src': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
      // `scripts/` holds build tooling (see scripts/vendorResources.mjs), which
      // mirrors into `test/scripts/` like any other source directory.
      '@scripts': fileURLToPath(new URL('./scripts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}']
  }
})
