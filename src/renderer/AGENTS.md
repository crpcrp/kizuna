# Renderer

Rules that differ inside `src/renderer/`. The repository-wide principles stay in
[AGENTS.md](../../AGENTS.md); file ownership is in
[docs/codebase-map.md](../../docs/codebase-map.md).

- No Node, filesystem, subprocess, database, or network access, and no imports
  from `src/main/`. Everything crossing the boundary goes through the typed
  preload API (`src/shared/preloadApi.ts`) exposed on `window.kizuna`.
- `src/renderer/src/components/` owns presentation; `src/renderer/src/state/`
  owns pure transitions, controllers, and hooks. Add behavior to the feature
  hook that already owns the workflow rather than to `App.tsx`.
- Components own their CSS file, and colors come from the semantic variables in
  `src/renderer/src/theme.css`. Do not add isolated color literals.
- There are two entry points: `index.html` → `src/main.tsx` (the player) and
  `gameOcr.html` → `src/gameOcr.tsx` (the Game OCR frozen frame, loaded into its
  own window). They share no React tree, and a new entry must be declared in
  `electron.vite.config.ts`'s renderer inputs. See
  [docs/game-ocr.md](../../docs/game-ocr.md).
