import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Bare-minimum config: three build targets (main / preload / renderer).
// electron-vite finds the entries by convention:
//   main    -> src/main/index.ts
//   preload -> src/preload/index.ts
//   renderer-> src/renderer/index.html
// main's rollupOptions.input is overridden below to add the dictionary-import
// worker thread and packaged smoke check. Once rollupOptions.input is set,
// electron-vite's convention lookup is skipped, so index.ts must be listed too.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          importWorker: resolve(__dirname, 'src/main/services/dict/importWorker.ts'),
          smoke: resolve(__dirname, 'src/main/smoke.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react()],
    // Force react/react-dom to be pre-bundled at dev-server startup instead
    // of lazily on the first page request. Without this, a fully cold start
    // triggers Vite's "new dependencies optimized, reloading page" mid-load,
    // and Electron's BrowserWindow (unlike a browser tab with a live HMR
    // socket) can miss that reload and render a blank window on first run —
    // fixed only by restarting once Vite's dep cache is warm.
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']
    },
    // optimizeDeps.include only covers npm packages; on a cold start Vite
    // still transforms our own module graph lazily as requests come in.
    // electron-vite launches Electron the moment the dev server reports
    // "listening", not once it's actually warm, so the very first request
    // (main.tsx and everything it imports) can race that lazy transform —
    // same failure mode as above, one more source of it. Pre-transforming
    // the entry chain here closes that gap.
    server: {
      // Fixed port (not Vite's default "pick another if busy" behavior):
      // the renderer's localStorage (keybindings, subtitle style, popup
      // settings — see uiHelpers.ts persistedSettings) is scoped to the page
      // origin, which includes this port. A drifting port silently starts
      // every `npm run dev` session on a fresh, empty localStorage bucket,
      // which reads as "my settings didn't persist" even though the write
      // itself worked fine. strictPort fails loudly instead of drifting, so
      // a stale dev-server process holding the port is caught immediately
      // rather than masked as a data-loss bug.
      port: 5173,
      strictPort: true,
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/App.tsx',
          './src/components/*.tsx',
          './src/state/*.ts',
          './src/util/*.ts'
        ]
      }
    }
  }
})
