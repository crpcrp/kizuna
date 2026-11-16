import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The test launcher uses Electron's Node ABI for better-sqlite3; Electron APIs use test fakes.
export default defineConfig({
  resolve: {
    // Keep in sync with `compilerOptions.paths` in tsconfig.json.
    alias: {
      '@src': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),

      '@scripts': fileURLToPath(new URL('./scripts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}']
  }
})
