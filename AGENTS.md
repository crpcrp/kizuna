# Agent guidelines

Kizuna is a Windows and Linux Electron/TypeScript application. Use
`docs/codebase-map.md` to locate subsystems and `docs/architecture.md` for
architectural changes.

## Output

- Keep every response and generated output laconic. Include only information
  needed for correctness or action.
- Be accurate. State material uncertainty or verification limits directly.
- Lead with the answer or result. Skip preambles, restatements, routine work
  narration, and discarded alternatives.
- Prefer concise prose; use lists only when they are shorter or clearer.
- When showing code, put it before any explanation and explain only non-obvious
  details.
- End when the request is answered; no recap or generic follow-up offer.

## Working principles

- Comment only what the code cannot say: a non-obvious reason, constraint, or
  external fact. One or two lines. No history, no restating the code or a type,
  no pointers to how another file does it.

- This is a hobby project, not an enterprise application. Never overengineer a
  task; choose the smallest practical solution and avoid enterprise ceremony.
- Keep changes focused on the requested outcome and preserve unrelated work.
- Prefer clear, conventional code over clever abstractions.
- Add tests for meaningful behavior and likely regressions, not trivial
  implementation details.
- Use fakes or fixtures for mpv, FFmpeg, MeCab, AnkiConnect, WaniKani, SQLite,
  and other external boundaries. Automated tests must not require live accounts,
  network services, or bundled binaries. Test local filesystem behavior in a
  temporary directory, with spies only for specific failure cases.
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

Run one file with `npm test -- run test\<path>.test.ts`; `npm test` runs
Vitest under Electron's Node ABI, which `better-sqlite3` requires.

## Git and pull requests

- Never commit development work directly to `main`.
- Keep unrelated changes out of the branch.
- Use the GitHub API, not local CLI commands, to create or update pull requests.
- For GitHub implementation tasks, publish a draft PR against `main` unless the
  user asks for a different handoff.
- The user reviews and merges the PR.
