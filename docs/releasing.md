# Releasing

Kizuna releases are signed Windows installers built by GitHub Actions from
version tags on `main`.

## One-time setup

Create a protected GitHub environment named `release` and add:

- `WINDOWS_CSC_LINK`: the base64-encoded code-signing certificate
- `WINDOWS_CSC_KEY_PASSWORD`: its password
- deployment rules allowing `main` and `v*.*.*` tags
- an environment reviewer, if approval should be required before signing

Also restrict creation of `v*` tags to maintainers.

## Create a release

1. Merge the version bump into `main`. The version in `package.json` must match
   the tag.
2. Optionally run the Release workflow manually from `main`. This builds, signs,
   installs, smoke-tests, and uninstalls the app but cannot publish it.
3. Create and push the tag:

   ```powershell
   git tag -a v1.2.3 -m "Kizuna 1.2.3"
   git push origin v1.2.3
   ```

4. Approve the `release` environment if required.
5. Download the installer from the draft release and manually check install,
   upgrade from the previous release, playback, subtitle extraction, MeCab
   tokenization, the vocabulary database, and uninstall.
6. Publish the draft from GitHub.

The automated smoke check catches missing packaged resources and a broken
`better-sqlite3` Electron ABI. It deliberately does not use media, networks, or
accounts.

The draft contains the signed installer, `SHA256SUMS.txt`, the third-party
notices/corresponding-source bundle, and GitHub build provenance. The installer
is timestamped but not bit-for-bit reproducible; the workflow instead pins its
inputs and records checksums and provenance for its outputs.
