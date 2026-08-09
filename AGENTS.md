# Agent guidelines

Kizuna is a Windows and Linux Electron and TypeScript application. Use
`docs/codebase-map.md` when you need help locating a subsystem and
`docs/architecture-plan.md` when a change affects architecture.

## Working principles

- Keep changes focused on the requested outcome and preserve unrelated work.
- Prefer clear, conventional code over clever abstractions.
- Add or update tests when they protect meaningful behavior or a likely
  regression. A trivial function does not need a test merely because it exists.
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
- Report what you changed, what you verified, and anything you could not verify.

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
- For GitHub implementation tasks, publish a draft PR against `main` unless the
  user asks for a different handoff.
- The user reviews and merges the PR.

A change is ready when the requested behavior is implemented, relevant checks
pass (or limitations are stated), and the diff contains no unrelated work.
