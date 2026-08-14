# Agent guidelines

Kizuna is a Windows and Linux Electron/TypeScript application. Use
`docs/codebase-map.md` to locate subsystems and `docs/architecture-plan.md` for
architectural changes.

## Output

- Be accurate. State material uncertainty or verification limits directly.
- Minimize output and token usage without omitting information needed for
  correctness.
- Lead with the answer or result. Skip preambles, restatements, routine work
  narration, and discarded alternatives.
- Avoid hedging unless uncertainty matters. Do not repeat known context or
  earlier results.
- Prefer concise prose; use lists only when they are shorter or clearer.
- When showing code, put it before any explanation and explain only non-obvious
  details.
- End when the request is answered; no recap or generic follow-up offer.

## Working principles

- Keep changes focused on the requested outcome and preserve unrelated work.
- Prefer clear, conventional code over clever abstractions.
- Add tests for meaningful behavior and likely regressions, not trivial
  implementation details.
- Use fakes or fixtures for mpv, FFmpeg, MeCab, AnkiConnect, WaniKani, SQLite,
  and other external boundaries. Automated tests must not require live accounts,
  network services, or bundled binaries.
- Keep tests independent of the host OS. Pass an explicit platform to code that
  derives filesystem paths and assert both variants (see "Derive a filesystem
  path" in `docs/codebase-map.md`). Skipping a case for the running platform is
  a last resort, and each skip must name the technical reason and its
  counterpart coverage.
- Update documentation only when setup, user-visible behavior, architecture, or
  a public interface changes.

## Validation

Run the smallest useful check while iterating, then the relevant project checks
before handoff when the environment supports them:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
```

Focused Vitest runs must use Electron's Node ABI because of `better-sqlite3`:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run test\<path>.test.ts
```

Do not call live external integrations from tests.

## Git and pull requests

- Never commit development work directly to `main`.
- Keep unrelated changes out of the branch.
- Use the GitHub API, not local CLI commands, to create or update pull requests.
- For GitHub implementation tasks, publish a draft PR against `main` unless the
  user asks for a different handoff.
- The user reviews and merges the PR.
