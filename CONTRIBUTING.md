# Contributing to Kizuna

Thanks for contributing. Setup, development, testing, and packaging commands are
documented in [README.md](README.md).

Before starting a substantial change, open an issue to confirm that it fits the
project. Small fixes such as typos and broken links do not need an issue first.
Security vulnerabilities must be reported privately as described in
[SECURITY.md](SECURITY.md).

## Pull requests

1. Fork the repository and branch from an up-to-date `main`.
2. Make one coherent change.
3. Add or update tests where they provide useful regression coverage.
4. Run the checks relevant to your change.
5. Open a pull request and describe the result and validation performed.

Tests must use the existing fakes and fixtures for external tools, accounts,
network services, and SQLite-facing scenarios. Do not commit secrets, personal
data, copyrighted media, or real dictionary files.

The usual local checks are:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
```

A green build does not guarantee that a change will merge; the maintainer also
decides whether it fits the project.

## Continuous integration

Every pull request and every push to `main` runs two independent jobs:

| Check | Host | Runs |
|---|---|---|
| `CI / Windows x64` | `windows-latest` | Resource staging, typecheck, lint, format check, full test suite, notices, production build |
| `CI / Linux x64` | `ubuntu-24.04` | The same steps against the Linux runtime payload |

Neither job is advisory: Linux runs the complete suite, and both must pass.
Both check names are configured as required status checks for `main` in the
repository's branch protection settings.

## Licensing

Kizuna is licensed under GPL-3.0-or-later. Contributions are accepted under the
same license, without a separate contributor license agreement or required
commit sign-off.

Only contribute code and assets that you have the right to license. Changes to
runtime dependencies or bundled binaries may also require updates to
[docs/licensing.md](docs/licensing.md), `third-party.json`, and the generated
notices.
