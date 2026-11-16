# Scripts

- Plain ESM `.mjs` runnable with bare `node`, before any build step exists. No
  TypeScript, no bundler, no dependency on `src/`.
- Entry points own argv, environment, I/O, and exit codes. Extract an importable
  helper only when it contains logic worth testing; use temporary directories
  and injected effects for external boundaries.
- Fail closed. A hash, manifest, layout, or licence mismatch aborts the run
  rather than producing a partial artifact.
- Change these together: `resources.lock.json` and `third-party.json`, then run
  `npm run notices` and `npm test`. A bundled binary can only change through a
  reviewed lock diff.
