# Releasing

Kizuna's early Windows pre-releases are built unsigned by GitHub Actions. The
workflow still runs the full test suite, installs and smoke-tests the packaged
app, records checksums, and creates build provenance.

Windows will show an unknown-publisher warning and may display Microsoft
Defender SmartScreen. Signed releases are planned after the project is accepted
by an open-source signing service.

## Create a release from GitHub

1. Merge the version bump into `main`. The versions in `package.json` and
   `package-lock.json` must match.
2. Open **Actions**, select **Release**, and choose **Run workflow**.
3. Select `main`, enable **Create the version tag and a draft pre-release**, and
   run the workflow.
4. Wait for both the build and publish jobs to pass. The workflow creates the
   version tag only after the installer has passed its automated checks.
5. Download the installer from the draft release and manually check install,
   upgrade from the previous release when applicable, playback, subtitle
   extraction, MeCab tokenization, the vocabulary database, and uninstall.
6. Keep the release marked as a pre-release and publish the draft.

Leave the release option disabled to run the same build and smoke checks without
creating a tag or draft release.

## Create a release from Git

Maintainers may instead create a tag after merging the matching version bump:

```powershell
git switch main
git pull --ff-only
git tag -a v1.2.3 -m "Kizuna 1.2.3"
git push origin v1.2.3
```

The tag must match the package version and point to a commit in `main`.

## Release contents

The draft contains the unsigned installer, `SHA256SUMS.txt`, the third-party
notices and corresponding-source bundle, and GitHub build provenance. The
installer is not bit-for-bit reproducible; the workflow instead pins its inputs
and records checksums and provenance for its outputs.

The automated smoke check catches missing packaged resources and a broken
`better-sqlite3` Electron ABI. It deliberately does not use media, networks, or
accounts.
