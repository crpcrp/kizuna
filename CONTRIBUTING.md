# Contributing to Kizuna

Before a substantial change, open an issue to confirm scope. Small fixes need
no issue. Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Development

Building from source requires Node.js 24 or newer and npm. Windows development
uses staged runtime copies under `resources/`; unpackaged Linux development
uses the distribution's `mpv`, FFmpeg/ffprobe, and MeCab commands. See
[Binary setup](docs/binaries.md) for download sources, expected paths, and
version checks.

Install dependencies and start the development app:

```powershell
npm install
npm run dev
```

To build once and run the production preview:

```powershell
npm run build
npm start
```

### Linux

On Ubuntu 24.04, install Node.js 24 and the native build/runtime dependencies,
then use the normal npm workflow:

```bash
sudo apt update
sudo apt install -y build-essential python3 pkg-config mpv ffmpeg mecab mecab-ipadic-utf8
npm ci
npm run dev
```

Use a checkout on the Linux filesystem and do not reuse a `node_modules`
directory produced on Windows; Electron and `better-sqlite3` contain
platform-specific binaries. Kizuna selects Electron's X11/XWayland backend
before startup, so no command-line wrapper is required. To run the production
bundle locally, use `npm run build && npm start`.

## Checks and packaging

Run the standard checks:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
```

Use `npm run test:watch` locally or `npm test -- run test/<path>.test.ts` for one file.

```powershell
npm run build  # Production build in out/
npm run dist   # Windows NSIS installer in dist/
npm run dist:linux # Linux AppImage and deb in dist/ (Ubuntu 24.04 only)
```

Packaging stages [runtime binaries](docs/binaries.md) and generates
[notices](docs/licensing.md); see [Releasing](docs/releasing.md) for distribution.

## Pull requests

1. Fork and branch from current `main`.
2. Make one coherent change and add useful regression coverage.
3. Run the relevant checks and describe the result and validation in a PR.

Follow [AGENTS.md](AGENTS.md) and the scoped guidelines. Do not commit secrets,
personal data, copyrighted media, or real dictionary files. The maintainer
reviews project fit as well as correctness.

CI runs resource staging, typecheck, lint, formatting, the full test suite,
notices, and a production build on Windows x64 and Ubuntu 24.04 x64. Both
`CI / Windows x64` and `CI / Linux x64` are required by branch protection.
Packaging smoke tests run in the release workflow; see [Releasing](docs/releasing.md).

## Licensing

Contributions use GPL-3.0-or-later without a separate CLA or required sign-off.
Contribute only code and assets you have the right to license. Dependency or
binary changes may require [licensing metadata](docs/licensing.md) and notice updates.
