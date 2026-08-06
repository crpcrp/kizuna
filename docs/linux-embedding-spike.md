# Linux embedding spike

This document describes the development-only Linux test environment for the
Kizuna X11/XWayland embedding spike. It targets Ubuntu 24.04 x64 inside WSL2
with WSLg on a Windows host. Linux support is experimental and unreleased: this
setup does not produce a Linux package or a supported download.

The commands below stage system-installed executables into Kizuna's existing
gitignored `resources/` layout. They are for the spike only. **Do not run
`npm run resources` on Linux during this spike.** The current lock file contains
Windows binaries and remains the Windows release lock.

## 1. Prerequisites

Use one of these Windows baselines:

- Windows 11 22H2 or newer, fully updated (recommended); or
- Windows 10 22H2 or newer with the current Microsoft Store WSL package and
  WSLg updates installed.

The test environment must also have:

- WSL 2 with an Ubuntu 24.04 x64 distribution;
- WSLg installed and current, with virtualization enabled in UEFI/BIOS and
  the Windows Virtual Machine Platform feature enabled;
- at least 10 GB free in the Ubuntu distribution for dependencies, build
  output, and a test video;
- a current Windows GPU driver. WSLg can fall back to software rendering, but
  record which renderer was used in the evidence section below;
- the repository cloned inside the Linux filesystem, such as
  `~/src/kizuna`, **not** under `/mnt/c` or another mounted Windows path; and
- an x64 environment. ARM64 is outside this spike.

From an elevated PowerShell window, update WSL and verify the versions before
opening Ubuntu:

```powershell
wsl --update
wsl --version
wsl -l -v
```

If Ubuntu 24.04 is not installed yet, install it from elevated PowerShell and
restart Windows if requested:

```powershell
wsl --install --distribution Ubuntu-24.04
wsl --set-version Ubuntu-24.04 2
wsl -l -v
```

The `wsl -l -v` output must show `VERSION 2` for `Ubuntu-24.04`. If
`wsl --version` is not available, install or update the Microsoft Store WSL
package before continuing; do not infer WSLg availability from the distro
version alone.

## 2. Verify WSLg and the display

Open Ubuntu 24.04 and run these commands. WSLg should provide both display
variables. `XDG_SESSION_TYPE` is recorded for diagnostics but is not required
to have one particular value in a WSL shell.

```bash
printf 'DISPLAY=%s\nWAYLAND_DISPLAY=%s\nXDG_SESSION_TYPE=%s\n' \
  "${DISPLAY-}" "${WAYLAND_DISPLAY-}" "${XDG_SESSION_TYPE-}"

test -n "${DISPLAY-}" || {
  echo 'DISPLAY is empty; WSLg/XWayland is not available.' >&2
  exit 1
}
test -n "${WAYLAND_DISPLAY-}" || {
  echo 'WAYLAND_DISPLAY is empty; WSLg is not available.' >&2
  exit 1
}
```

Install the display checks and run them. `xeyes` should open a small X11
window; close it with `Ctrl+C` in the terminal or by closing the window.

```bash
sudo apt-get update
sudo apt-get install -y x11-apps mesa-utils
xeyes
glxinfo -B
```

Save the complete `glxinfo -B` output. It identifies the renderer and makes it
possible to distinguish GPU-backed WSLg from software rendering.

## 3. Install development and runtime dependencies

These are the Ubuntu 24.04 packages needed by Electron, native Node modules,
the display checks, and the Kizuna runtime. `ffprobe` is provided by the
`ffmpeg` package.

```bash
sudo apt-get install -y \
  build-essential \
  python3 \
  pkg-config \
  curl \
  ca-certificates \
  git \
  git-lfs \
  libgtk-3-0t64 \
  libnss3 \
  libatk-bridge2.0-0t64 \
  libdrm2 \
  libgbm1 \
  libasound2t64 \
  libxshmfence1 \
  libxrandr2 \
  libxdamage1 \
  libxcomposite1 \
  libxfixes3 \
  libxss1 \
  libxtst6 \
  libxkbcommon0 \
  libxkbcommon-x11-0 \
  libxcb-dri3-0 \
  libxcb-icccm4 \
  libxcb-keysyms1 \
  libxcb-randr0 \
  libxcb-render-util0 \
  libxcb-shape0 \
  libxcb-xfixes0 \
  libx11-xcb1 \
  libglib2.0-0t64 \
  libpango-1.0-0 \
  libcups2t64 \
  mpv \
  ffmpeg \
  mecab \
  mecab-ipadic-utf8 \
  yt-dlp
```

Install Node.js 24 inside WSL. Do not use the Windows `node.exe` from the
Linux shell.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

`node --version` must report `v24.x`. Initialize Git LFS even though this
spike stages Linux system executables instead of downloading the Windows
resource lock:

```bash
git lfs install
git lfs version
```

## 4. Clone or enter the repository

The working tree must be on the Linux filesystem. If it is not already
available in WSL, clone it under `~/src`:

```bash
mkdir -p ~/src
cd ~/src
git clone https://github.com/crpcrp/kizuna.git
cd kizuna
```

Check out the branch or commit under test. For the merged Linux-spike branch,
the following is a reproducible example; replace the ref when testing a PR
before it is merged:

```bash
git fetch origin feature/linux-embedding-spike
git switch --detach origin/feature/linux-embedding-spike
```

Confirm that the working tree is in the Linux filesystem before staging
resources:

```bash
pwd
case "$PWD" in
  /mnt/*) echo 'Refusing to continue under /mnt; move the checkout into the Linux filesystem.' >&2; exit 1 ;;
esac
```

## 5. Stage Linux runtime resources

Run this from the repository root. It creates the existing resource folders
and links the system executables to the exact extensionless Linux paths used by
`src/main/resourcePaths.ts`:

```bash
set -euo pipefail

mkdir -p resources/mpv resources/ffmpeg resources/mecab resources/yt-dlp

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required executable is not on PATH: $1" >&2
    return 1
  fi
  command -v "$1"
}

link_runtime() {
  local source="$1"
  local target="$2"
  local resolved_source
  local resolved_target

  resolved_source="$(readlink -f "$source")"
  if [[ -e "$target" || -L "$target" ]]; then
    resolved_target="$(readlink -f "$target" || true)"
    if [[ "$resolved_target" == "$resolved_source" ]]; then
      echo "Already linked: $target -> $source"
      return 0
    fi
    echo "Refusing to overwrite existing path: $target" >&2
    echo "Remove or move it manually if it is not the intended resource." >&2
    return 1
  fi

  ln -s "$source" "$target"
  echo "Linked: $target -> $source"
}

link_runtime "$(require_command mpv)" resources/mpv/mpv
link_runtime "$(require_command ffmpeg)" resources/ffmpeg/ffmpeg
link_runtime "$(require_command ffprobe)" resources/ffmpeg/ffprobe
link_runtime "$(require_command mecab)" resources/mecab/mecab
link_runtime "$(require_command yt-dlp)" resources/yt-dlp/yt-dlp
```

Locate the UTF-8 IPADIC directory from the installed package instead of
assuming a distro-specific path. The command must find exactly one directory
containing `sys.dic`, validate it, and link that directory to
`resources/mecab/ipadic`:

```bash
set -euo pipefail

mapfile -t ipadic_dirs < <(
  dpkg -L mecab-ipadic-utf8 \
    | awk '$0 ~ /\/sys\.dic$/ { sub(/\/sys\.dic$/, ""); print }' \
    | sort -u
)

if (( ${#ipadic_dirs[@]} != 1 )); then
  echo 'Could not identify exactly one UTF-8 IPADIC directory.' >&2
  dpkg -L mecab-ipadic-utf8 >&2
  exit 1
fi

ipadic_dir="${ipadic_dirs[0]}"
if [[ ! -f "$ipadic_dir/sys.dic" ]]; then
  echo "The selected IPADIC directory has no sys.dic: $ipadic_dir" >&2
  exit 1
fi

link_runtime "$ipadic_dir" resources/mecab/ipadic
printf 'Using UTF-8 IPADIC: %s\n' "$ipadic_dir"
```

If either block reports a missing executable, an ambiguous dictionary, or an
existing path that points somewhere else, stop and inspect the diagnostic
output. Do not replace the path blindly: the staging procedure must not
overwrite a real user file.

## 6. Verify staged runtimes

Run each version check through the staged path, not through an unqualified
command. The output is part of the environment evidence.

```bash
resources/mpv/mpv --version
resources/ffmpeg/ffmpeg -version
resources/ffmpeg/ffprobe -version
resources/mecab/mecab -v
resources/yt-dlp/yt-dlp --version
```

Run a Japanese MeCab smoke test with the staged dictionary:

```bash
printf '日本語を勉強します。\n' \
  | resources/mecab/mecab -d resources/mecab/ipadic
```

Use a real local MKV or MP4 to verify standalone mpv through X11/XWayland
before starting Electron. Replace the example path with an absolute path to a
file inside the Linux filesystem:

```bash
resources/mpv/mpv \
  --no-config \
  --vo=gpu \
  --gpu-context=x11egl \
  --force-window=yes \
  "/home/<linux-user>/Videos/example.mkv"
```

The video must open in an X11 window. If this command fails, capture its full
output and resolve the WSLg/mpv issue before testing Kizuna.

## 7. Verify the project

From the repository root, install dependencies and run every automated check.
Do not run `npm run resources` on this machine during the spike.

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
```

Start the development app and save the terminal output. Keep this process
running while completing the manual checklist.

```bash
npm run dev 2>&1 | tee ~/kizuna-linux-spike.log
```

Close Kizuna normally after the manual run. If mpv does not start, inspect the
saved log and the process/socket state:

```bash
grep -nEi 'mpv|ipc|socket|wid|x11|error|unhandled|reconnect' \
  ~/kizuna-linux-spike.log
pgrep -af '[m]pv' || true
find /tmp -maxdepth 1 -type s -name 'kizuna-mpv-*.sock' -print
```

After confirming that any listed process belongs to this Kizuna run, terminate
it by its PID. Remove only stale Kizuna sockets; never clean all of `/tmp`:

```bash
find /tmp -maxdepth 1 -type s -name 'kizuna-mpv-*.sock' -delete
```

Record whether a normal close terminated mpv and removed the socket. Repeated
IPC reconnect errors, orphaned mpv processes, and stale sockets are failures
for the relevant checklist item.

## 8. Environment and version evidence

Record the following in the PR or test result. Include the complete output from
`glxinfo -B` or attach it as a log.

```text
Windows version:
wsl --version:
wsl -l -v:
Ubuntu version:              (run `lsb_release -ds`)
XDG_SESSION_TYPE:            (run `echo "$XDG_SESSION_TYPE"`)
DISPLAY:                     (run `echo "$DISPLAY"`)
WAYLAND_DISPLAY:             (run `echo "$WAYLAND_DISPLAY"`)
Electron version:            (run `npx electron --version`)
mpv version:                 (run `resources/mpv/mpv --version`)
FFmpeg version:              (run `resources/ffmpeg/ffmpeg -version`)
MeCab version:               (run `resources/mecab/mecab -v`)
GPU information:             (attach `glxinfo -B`)
Rendering mode:              GPU / software (state which)
```

## 9. Manual pass/fail checklist

Complete every row with a pass or fail mark and notes. Do not mark an item as
passed from unit tests alone.

1. `npm run dev` opens one Kizuna window without a second standalone mpv window.  Pass [ ]  Fail [ ]  Notes:
2. A local MKV or MP4 opens and video is visible behind the DOM controls.  Pass [ ]  Fail [ ]  Notes:
3. The menu, subtitle area, and bottom controls remain visible over the video.  Pass [ ]  Fail [ ]  Notes:
4. Play/pause, seek, volume, mute, speed, frame step, and fullscreen work.  Pass [ ]  Fail [ ]  Notes:
5. Resizing the window continuously resizes the video without detaching it.  Pass [ ]  Fail [ ]  Notes:
6. Mini-player mode enters and exits correctly.  Pass [ ]  Fail [ ]  Notes:
7. Embedded and external subtitles load and remain DOM-rendered rather than being drawn by mpv.  Pass [ ]  Fail [ ]  Notes:
8. Audio-device enumeration returns without breaking playback.  Pass [ ]  Fail [ ]  Notes:
9. Screenshot capture creates a valid PNG.  Pass [ ]  Fail [ ]  Notes:
10. Closing Kizuna terminates mpv and leaves no `kizuna-mpv-*.sock` file.  Pass [ ]  Fail [ ]  Notes:
11. Starting Kizuna a second time focuses the first instance.  Pass [ ]  Fail [ ]  Notes:
12. The terminal contains no unhandled rejection or repeated IPC reconnect error.  Pass [ ]  Fail [ ]  Notes:

## 10. Result

Complete this section only after the full WSLg checklist has been run with real
mpv and a real local video.

### Current status: BLOCKED

The validation was not run in this agent environment. It is a root Linux
container rather than the required Windows host with Ubuntu 24.04 under WSL2
and WSLg: the `wsl` command is unavailable, and both `DISPLAY` and
`WAYLAND_DISPLAY` are unset. No real window, standalone mpv, or Kizuna
embedding result was therefore observed.

This is an environment limitation, not a GO or NO-GO finding about Kizuna. No
manual checklist item is marked as passed or failed, and the automated checks
must not be treated as a substitute for the required WSLg evidence. A Windows
operator must rerun sections 1–9, attach the requested environment and runtime
evidence, complete all 12 observations, and replace this status with GO or
NO-GO before the spike can be concluded.

- [ ] **GO:** X11/XWayland embedding works and the existing playback
  architecture can be extended.
- [ ] **NO-GO:** embedding fails; record the exact failed checklist items and
  link the logs from the PR.
- [x] **BLOCKED:** the required Windows/WSLg environment was unavailable for
  this validation attempt; no embedding conclusion was made.

Failed checklist items:

Logs or attachments:
