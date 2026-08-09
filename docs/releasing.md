# Releasing

Kizuna's Windows and Linux x64 pre-releases are built unsigned by GitHub
Actions. Separate platform jobs run the full test suite and packaged smoke
tests before one draft release is created with checksums and build provenance.

Windows may show an unknown-publisher or Microsoft Defender SmartScreen
warning. The Linux AppImage and deb are also unsigned. Signing is planned only
after the project is accepted by an open-source signing service.

## Prepare the version

From a branch based on current `main`, update both package files without
creating a local tag:

```bash
npm version 1.2.3 --no-git-tag-version
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
```

Open and merge the version-bump PR. `package.json` and `package-lock.json` must
contain the same version before any release run.

## Rehearse without publishing

Open **Actions** → **Release** → **Run workflow**, select the branch to test,
leave **Create the version tag and a draft pre-release** disabled, and run it.
The validation, Windows x64, and Linux x64 jobs execute normally, including
both package smoke tests, but no tag, draft, or release asset is published.
Use this mode before merging a packaging or release-workflow change.

## Create a release from GitHub

1. Confirm the version bump and any release changes are merged into `main`.
2. Open **Actions** → **Release** → **Run workflow**.
3. Select `main`, enable **Create the version tag and a draft pre-release**, and
   run the workflow.
4. Wait for **Validate release ref**, **Build and smoke-test Windows x64**,
   **Build and smoke-test Linux x64**, and **Create draft pre-release** to pass.
   The workflow creates `v<version>` only after both platform jobs succeed.
5. Inspect the draft and complete the verification and manual QA below.
6. Keep the release marked as a pre-release and publish the draft.

Maintainers may instead create a tag after merging the matching version bump:

```bash
git switch main
git pull --ff-only
git tag -a v1.2.3 -m "Kizuna 1.2.3"
git push origin v1.2.3
```

The tag must match the package version and point to a commit in `main`. A tag
push runs the same platform and publish jobs.

## Automated package coverage

The Windows job installs the NSIS package into a clean directory, runs the
packaged resource probe through the installed executable, checks the
`better-sqlite3` Electron ABI, and uninstalls it.

On a clean Ubuntu 24.04 runner, `npm run dist:linux` produces the AppImage and
deb and `npm run smoke:linux` verifies that:

- both artifacts contain the Linux resources, notices, and icons, no Windows
  binaries, and the required executable modes;
- bundled mpv, FFmpeg/ffprobe, and MeCab start, and MeCab tokenizes with the
  bundled IPADIC;
- the deb declares the exact mpv and FFmpeg dependencies, installs, reinstalls,
  registers its desktop entry and icons, and uninstalls without package files;
- the deb and AppImage launchers select X11 automatically, which mpv's embedded
  `--wid` surface requires even when the desktop session is Wayland;
- the AppImage runs from a clean user directory through the supported
  `--appimage-extract-and-run` no-FUSE path;
- the application starts under `xvfb-run` with isolated user data and generated
  local media, reaching the window, mpv IPC, and renderer milestones offline.

Failures upload one log per failed Linux check as `linux-packaging-logs`.
Packaging stays out of per-commit CI; `test/linuxPackagingConfig.test.ts` and
`test/releaseWorkflow.test.ts` catch static configuration drift there. Either
release platform failing or being cancelled prevents the tag and draft.

To run the Linux package checks locally on Ubuntu 24.04:

```bash
sudo apt-get install --yes xvfb 'mpv=0.37.0-1ubuntu4' 'ffmpeg=7:6.1.1-3ubuntu5'
npm run resources -- --platform linux-x64
npm run dist:linux
npm run smoke:linux
```

## Draft contents and verification

For version `1.2.3`, the draft must contain exactly:

| Platform | Release assets |
|---|---|
| Windows x64 | `kizuna-1.2.3-setup.exe`, `kizuna-1.2.3-setup.exe.blockmap`, `latest.yml`, `kizuna-1.2.3-windows-x64-notices.zip` |
| Linux x64 | `kizuna-1.2.3-linux-x86_64.AppImage`, `kizuna-1.2.3-linux-amd64.deb`, `latest-linux.yml`, `kizuna-1.2.3-linux-x64-notices.tar.gz` |
| Shared | `SHA256SUMS.txt` and GitHub build provenance for every asset |

Download all nine files into one clean directory and run:

```bash
sha256sum --check --strict SHA256SUMS.txt
for asset in kizuna-1.2.3-*; do
  gh attestation verify "$asset" --repo crpcrp/kizuna
done
```

Also verify the tag targets the intended `main` commit, the draft identifies
Windows 10+ and Ubuntu 24.04 x64, the release remains a pre-release, and every
asset is unsigned as stated. The packages are not bit-for-bit reproducible;
the workflow instead pins inputs and records checksums and provenance.

Inspect `latest.yml` and `latest-linux.yml` before publishing. Each `files.url`
must be a bare filename present in the draft, and its `size` and `sha512` must
match that asset. `latest.yml` selects only the NSIS installer.
`latest-linux.yml` contains both the AppImage and deb; electron-updater 6.8.9+
uses the packaged `package-type` marker to select the matching format. The
workflow performs these filename, size, and SHA-512 checks before creating the
draft and rejects missing, extra, duplicate, cross-platform, or unsafe paths.

The workflow and builder use the `latest` channel for published pre-releases.
The updater service must use electron-updater 6.8.9 or newer and explicitly
enable pre-release updates for clients that should receive them. GitHub drafts
are not discoverable. A future stable release can use the same metadata names;
stable clients must leave pre-release updates disabled, and normal semantic
version comparison prevents installing an older release. Update downloads use
the public GitHub HTTPS provider and require no token in the application.

## Manual QA

Use clean user data. After installing packages and resolving dependencies,
disable networking for the offline checks. Verify the documented filenames,
commands, release links, warnings, and UI labels as you follow the checklist.

| Check | Windows 10/11 x64 | Ubuntu 24.04 x64 deb | Ubuntu 24.04 x64 AppImage |
|---|---|---|---|
| Install/start | Install to a non-default directory and launch from Start | `sudo apt install ./kizuna-<version>-linux-amd64.deb`; launch from the desktop menu | Copy to a clean user directory, `chmod +x`, and launch normally; also test `--appimage-extract-and-run` |
| Local playback | Open a local MKV/MP4 and confirm embedded mpv video and audio | Same under an X11 or XWayland session | Same under an X11 or XWayland session |
| Subtitles | Select an embedded track, extract it, and confirm selectable on-video text and sidebar cues | Same | Same |
| Tokenization | Open a Japanese word and confirm MeCab tokens and offline dictionary lookup | Same | Same |
| Local data | Import a small dictionary, change settings, restart, and confirm the SQLite-backed state returns | Same | Same |
| Offline behavior | With networking disabled, repeat local playback, subtitles, tokenization, and database startup | Same | Same |
| Upgrade/cleanup | Upgrade from the previous pre-release when available, then uninstall and confirm the app is removed | Reinstall/upgrade with `apt`, then `sudo apt remove kizuna` and confirm the launcher is removed | Replace the file with the new AppImage, then delete it and confirm no installed launcher was claimed |

## Packaged update rehearsal

After the runtime updater service is available, rehearse every N-1 to N release
before publishing. Keep the N draft unpublished while checking its metadata,
then publish it as a pre-release so the test clients can discover it; drafts
must not be discoverable.

1. Install the previous published pre-release on clean Windows 10/11 and Ubuntu
   24.04 test systems. On Linux, test the deb and AppImage separately.
2. Start N-1 once and confirm it identifies its installed package type. For the
   AppImage, launch the file directly so the `APPIMAGE` environment is present.
3. Publish N as a pre-release and check for updates from N-1.
4. Confirm NSIS downloads the `.exe`, deb downloads the `.deb` and requests the
   expected package-manager authentication/elevation, and AppImage downloads
   the `.AppImage`. No Linux installation may select the other format.
5. Install the update, restart, and confirm the running version is N and the
   existing user data remains intact. Repeat the playback, subtitle,
   tokenization, and dictionary checks from the manual QA table.
6. For NSIS, confirm the `.blockmap` is available and a differential download
   can fall back to the full installer. For AppImage, confirm the embedded
   blockmap can likewise fall back to the full image. The deb update is a full
   package download.
7. Restore or uninstall each test installation and record the result in the
   release notes. If any update path fails, withdraw the pre-release and fix it
   before treating N as the supported update.

macOS, ARM, Windows older than 10, Linux distributions other than Ubuntu 24.04,
native Wayland without XWayland, and headless sessions are unsupported. Do not
publish until any observed deviation from this documentation is either fixed
or documented accurately.
