# Scripts

Rules that differ inside `scripts/`. The repository-wide principles stay in
[AGENTS.md](../AGENTS.md); the surrounding workflows are in
[docs/binaries.md](../docs/binaries.md),
[docs/licensing.md](../docs/licensing.md), and
[docs/releasing.md](../docs/releasing.md).

- Plain ESM `.mjs` runnable with bare `node`, before any build step exists. No
  TypeScript, no bundler, no dependency on `src/`.
- Keep the split: the executable entry point (`fetch-resources.mjs`,
  `generate-notices.mjs`, `smoke-linux-package.mjs`, `run-tests.mjs`,
  `validate-update-metadata.mjs`) owns argv, environment, filesystem, network,
  and exit codes; the pure logic lives in an importable helper
  (`vendorResources.mjs`, `notices.mjs`, `linuxPackaging.mjs`,
  `testResults.mjs`) that `test/scripts/` exercises with injected effects and
  temp directories.
- Fail closed. A hash, manifest, layout, or licence mismatch aborts the run
  rather than producing a partial artifact.
- Change these together: `resources.lock.json` and `third-party.json`, then run
  `npm run notices` and `npm test`. A bundled binary can only change through a
  reviewed lock diff.
