# Renderer

- No Node, filesystem, subprocess, database, or network access, and no imports
  from `src/main/`. Everything crossing the boundary goes through the typed
  preload API (`src/shared/preloadApi.ts`) exposed on `window.kizuna`.
- `src/renderer/src/components/` owns presentation; `src/renderer/src/state/`
  owns pure transitions, controllers, and hooks. Add behavior to the feature
  hook that already owns the workflow rather than to `App.tsx`.
- Components own their CSS file, and colors come from the semantic variables in
  `src/renderer/src/theme.css`. Do not add isolated color literals.
- Do not create a module for a function with one caller unless it holds non-trivial logic.
