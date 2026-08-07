#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
state_dir="${XDG_DATA_HOME:-$HOME/.local/share}/kizuna-vm"
node_root="$state_dir/node"
linux_modules="$state_dir/node_modules"
linux_resources="$state_dir/resources"
linux_out="$state_dir/out"
linux_dist="$state_dir/dist"
linux_vite="$state_dir/vite"

usage() {
  cat <<'EOF'
Usage: bash scripts/vm-dev-shell.sh [--install|--setup|--dev]

  --install  Install Ubuntu packages and a private Node.js 24 runtime, then set up Kizuna.
  --setup    Set up mounts, runtime resources, and npm dependencies without apt installs.
  --dev      Set up if needed and start Kizuna immediately.
  (none)     Set up if needed and open a shell in the repository.
EOF
}

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'This script must run inside the Ubuntu VM.\n' >&2
  exit 1
fi

if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  printf 'This launcher is for a full Ubuntu VM, not WSL.\n' >&2
  printf 'Use scripts/wsl-dev-shell.sh inside WSL.\n' >&2
  exit 1
fi

action="${1-}"
case "$action" in
  '' | --install | --setup | --dev) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

pick_ubuntu_package() {
  local candidate
  for candidate in "$@"; do
    if apt-cache show "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf 'None of these Ubuntu packages are available: %s\n' "$*" >&2
  return 1
}

install_ubuntu_packages() {
  printf 'Updating Ubuntu package metadata...\n'
  sudo apt-get update

  local gtk_package atk_package asound_package glib_package cups_package
  gtk_package="$(pick_ubuntu_package libgtk-3-0t64 libgtk-3-0)"
  atk_package="$(pick_ubuntu_package libatk-bridge2.0-0t64 libatk-bridge2.0-0)"
  asound_package="$(pick_ubuntu_package libasound2t64 libasound2)"
  glib_package="$(pick_ubuntu_package libglib2.0-0t64 libglib2.0-0)"
  cups_package="$(pick_ubuntu_package libcups2t64 libcups2)"

  sudo apt-get install -y \
    build-essential python3 pkg-config curl ca-certificates git git-lfs xz-utils \
    cifs-utils "$gtk_package" libnss3 "$atk_package" libdrm2 libgbm1 \
    "$asound_package" libxshmfence1 libxrandr2 libxdamage1 libxcomposite1 \
    libxfixes3 libxss1 libxtst6 libxkbcommon0 libxkbcommon-x11-0 \
    libxcb-dri3-0 libxcb-icccm4 libxcb-keysyms1 libxcb-randr0 \
    libxcb-render-util0 libxcb-shape0 libxcb-xfixes0 libx11-xcb1 \
    "$glib_package" libpango-1.0-0 "$cups_package" libnotify4 libsecret-1-0 \
    mpv ffmpeg mecab mecab-ipadic-utf8 yt-dlp xvfb xcompmgr xauth x11-utils
}

install_private_node() {
  if [[ -x "$node_root/bin/node" ]] && [[ "$($node_root/bin/node --version)" == v24.* ]]; then
    return
  fi

  local node_arch manifest archive temp_dir
  case "$(uname -m)" in
    x86_64) node_arch='x64' ;;
    aarch64 | arm64) node_arch='arm64' ;;
    *)
      printf 'Unsupported VM architecture for the Node.js download: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac

  printf 'Installing the latest Node.js 24 release privately in %s...\n' "$node_root"
  manifest="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)"
  archive="$(printf '%s\n' "$manifest" | awk -v suffix="-linux-$node_arch.tar.xz" 'index($2, suffix) && index($2, suffix) == length($2) - length(suffix) + 1 { print $2; exit }')"
  if [[ -z "$archive" ]]; then
    printf 'Could not find a Node.js 24 Linux archive for %s.\n' "$node_arch" >&2
    exit 1
  fi

  temp_dir="$(mktemp -d)"
  trap 'rm -rf -- "$temp_dir"' RETURN
  printf '%s\n' "$manifest" >"$temp_dir/SHASUMS256.txt"
  curl -fL "https://nodejs.org/dist/latest-v24.x/$archive" -o "$temp_dir/$archive"
  (
    cd "$temp_dir"
    awk -v file="$archive" '$2 == file { print; found = 1 } END { exit !found }' \
      SHASUMS256.txt | sha256sum --check --strict -
  )
  rm -rf -- "$node_root"
  mkdir -p "$node_root"
  tar -xJf "$temp_dir/$archive" --strip-components=1 -C "$node_root"
  rm -rf -- "$temp_dir"
  trap - RETURN
}

mount_private_directory() {
  local private_dir="$1"
  local project_dir="$2"
  mkdir -p "$private_dir" "$project_dir"
  if ! mountpoint -q "$project_dir"; then
    printf 'Mounting VM-private %s...\n' "${project_dir#"$repo_dir/"}"
    sudo mount --bind "$private_dir" "$project_dir"
  fi
}

if [[ "$action" == --install ]]; then
  install_ubuntu_packages
fi

for command_name in curl mountpoint sha256sum tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing command: %s\n' "$command_name" >&2
    printf 'Run: bash scripts/vm-dev-shell.sh --install\n' >&2
    exit 1
  fi
done

mkdir -p "$state_dir"
install_private_node
export PATH="$node_root/bin:$PATH"

mount_private_directory "$linux_modules" "$repo_dir/node_modules"
mount_private_directory "$linux_out" "$repo_dir/out"
mount_private_directory "$linux_dist" "$repo_dir/dist"
mount_private_directory "$linux_vite" "$repo_dir/.vite"

# Runtime resources contain OS-specific files whose names overlap the Windows
# bundle. Copy first-party icons once, then hide the Windows resources with a
# VM-private bind mount.
mkdir -p "$linux_resources"
if [[ -d "$repo_dir/resources/icons" && ! -d "$linux_resources/icons" ]]; then
  cp -a "$repo_dir/resources/icons" "$linux_resources/icons"
fi
mount_private_directory "$linux_resources" "$repo_dir/resources"

for runtime_command in mpv ffmpeg ffprobe mecab yt-dlp; do
  if ! command -v "$runtime_command" >/dev/null 2>&1; then
    printf 'Missing Linux runtime command: %s\n' "$runtime_command" >&2
    printf 'Run: bash scripts/vm-dev-shell.sh --install\n' >&2
    exit 1
  fi
done

ipadic_dir="$(readlink -f /var/lib/mecab/dic/debian 2>/dev/null || true)"
if [[ -z "$ipadic_dir" || ! -f "$ipadic_dir/sys.dic" ]]; then
  printf 'Could not resolve Ubuntu\x27s active MeCab dictionary.\n' >&2
  printf 'Run: sudo apt-get install mecab-ipadic-utf8\n' >&2
  exit 1
fi

mkdir -p resources/mpv resources/ffmpeg resources/mecab resources/yt-dlp
ln -sfn "$(command -v mpv)" resources/mpv/mpv
ln -sfn "$(command -v ffmpeg)" resources/ffmpeg/ffmpeg
ln -sfn "$(command -v ffprobe)" resources/ffmpeg/ffprobe
ln -sfn "$(command -v mecab)" resources/mecab/mecab
ln -sfn "$ipadic_dir" resources/mecab/ipadic
ln -sfn "$(command -v yt-dlp)" resources/yt-dlp/yt-dlp

lock_hash="$(sha256sum "$repo_dir/package-lock.json" | cut -d ' ' -f 1)"
installed_hash="$(cat "$state_dir/package-lock.sha256" 2>/dev/null || true)"
if [[ ! -x "$repo_dir/node_modules/.bin/electron-vite" || "$lock_hash" != "$installed_hash" ]]; then
  printf 'Installing Linux npm dependencies (first run or lock file changed)...\n'
  (cd "$repo_dir" && npm ci)
  printf '%s\n' "$lock_hash" >"$state_dir/package-lock.sha256"
fi

# Network/shared folders commonly do not forward inotify events. Polling makes
# edits from Codex on Windows reach the VM development server promptly.
export CHOKIDAR_USEPOLLING=1
export CHOKIDAR_INTERVAL="${CHOKIDAR_INTERVAL:-200}"

cd "$repo_dir"

if [[ "$action" == --install || "$action" == --setup ]]; then
  printf '\nKizuna VM setup is ready.\n'
  printf 'Start the app with: bash scripts/vm-dev-shell.sh --dev\n'
  exit 0
fi

if [[ "$action" == --dev ]]; then
  exec npm run dev
fi

printf '\nKizuna Ubuntu VM shell: %s\n' "$repo_dir"
printf 'VM-private state: %s\n' "$state_dir"
printf 'Start the app with: npm run dev\n\n'
exec bash --login
