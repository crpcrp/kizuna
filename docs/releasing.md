# Releasing

Kizuna's early Windows and Linux x64 pre-releases are built unsigned by GitHub
Actions. Separate platform jobs run the full test suite and packaged smoke
tests before one draft release is created with checksums and build provenance.

Windows will show an unknown-publisher warning and may display Microsoft
Defender SmartScreen. Signed releases are planned after the project is accepted
by an open-source signing service.

## Create a release from GitHub

1. Merge the version bump into `main`. The versions in `package.json` and
   `package-lock.json` must match.
2. Open **Actions**, select **Release**, and choose **Run workflow**.
3. Select `main`, enable **Create the version tag and a draft pre-release**, and
   run the workflow.
4. Wait for the validation, Windows x64, Linux x64, and publish jobs to pass.
   The workflow creates the version tag only after both platform packages pass
   their automated and packaged smoke checks.
5. Download the Windows installer, Linux AppImage and Debian package from the
   draft. Verify `SHA256SUMS.txt`, inspect their provenance, and manually check
   install, upgrade when applicable, playback, subtitle extraction, MeCab
   tokenization, the vocabulary database, and uninstall.
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

## Linux packaging

The release workflow also builds and verifies Linux x64 artifacts on every
release run. `npm run dist:linux` produces a versioned AppImage and `.deb`, and
`npm run smoke:linux` verifies them on a clean Ubuntu 24.04 runner:

- both artifacts contain the Linux runtime resources, notices, and icons, with
  no Windows binaries and with executable bits intact;
- every bundled tool starts, and MeCab tokenizes with the bundled IPADIC;
- the `.deb` declares the pinned `mpv` and `ffmpeg` dependencies, installs,
  reinstalls, and uninstalls cleanly with its desktop entry and icons;
- the AppImage runs from a clean directory through its supported
  `--appimage-extract-and-run` path, which does not require FUSE;
- the real application starts under `xvfb-run` with an isolated user-data
  directory and reports its window, mpv IPC, and renderer milestones.

Failures upload one log file per failed check as the `linux-packaging-logs`
artifact; the release files upload temporarily as `kizuna-linux-x64-release`.

Packaging is deliberately not part of per-commit CI, which stays at the
`CI / Windows x64`, `CI / Linux x64`, and `CodeQL` checks. Configuration drift
is caught there instead by `test/linuxPackagingConfig.test.ts`.

The Linux job gates publishing just like the Windows job. A failure or
cancellation on either platform prevents the tag and draft release from being
created.

To run the same checks locally on Ubuntu 24.04:

```bash
sudo apt-get install --yes xvfb 'mpv=0.37.0-1ubuntu4' 'ffmpeg=7:6.1.1-3ubuntu5'
npm run dist:linux
npm run smoke:linux
```

## Release contents

The draft contains the unsigned Windows installer, unsigned Linux x64 AppImage
and Debian package, platform-specific third-party notices and
corresponding-source bundles, one canonical `SHA256SUMS.txt`, and GitHub build
provenance. Ubuntu 24.04 is the minimum Linux baseline because the bundled
runtime tools depend on its pinned mpv and FFmpeg packages. The packages are
not bit-for-bit reproducible; the workflow instead pins its inputs and records
checksums and provenance for its outputs.

The Windows smoke check catches missing packaged resources and a broken
`better-sqlite3` Electron ABI. The Linux smoke check uses generated local media
but no networks or accounts.
