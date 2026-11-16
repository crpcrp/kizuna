# Tests

- Mirror source paths: a test for `src/main/services/settings.ts` belongs in
  `test/main/services/settings.test.ts`. Import through the `@src/` and `@test/`
  aliases, and resolve repository or fixture paths with `@test/paths`.
- Reach for the shared harness in `test/harness/` before writing a local fake:
  `fakeIpcMain.ts`, `fakeSettingsIo.ts`, `deferred.ts`, `dictFixtures.ts`,
  `fakeKizunaApi.ts`, and `platformPaths.ts`. Extend one rather than copying it.
- Test a behavior once, at the lowest layer that can observe it. A hook or
  component test covers only what the layer adds (wiring, effects, rendering).
  Do not export a function to test it; test it through its caller. One App
  integration test per user-visible flow.
