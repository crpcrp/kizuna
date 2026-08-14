# Tests

Rules that differ inside `test/`. The repository-wide principles stay in
[AGENTS.md](../AGENTS.md); the harness and path guidance is in
[docs/codebase-map.md](../docs/codebase-map.md).

- Mirror source paths: a test for `src/main/services/settings.ts` belongs in
  `test/main/services/settings.test.ts`. Import through the `@src/` and `@test/`
  aliases, and resolve repository or fixture paths with `@test/paths`.
- Reach for the shared harness in `test/harness/` before writing a local fake:
  `fakeIpcMain.ts`, `fakeSettingsIo.ts`, `deferred.ts`, `dictFixtures.ts`,
  `fakeKizunaApi.ts`, and `platformPaths.ts`. Extend one rather than copying it.
- Tests must not depend on the host OS. Pass an explicit platform and assert
  both variants with `describe.each(PATH_PLATFORMS)`. A skip is a last resort
  and must name its technical reason and counterpart coverage.
- No live binaries, accounts, or network calls, and no secrets or personal data
  in fixtures.
