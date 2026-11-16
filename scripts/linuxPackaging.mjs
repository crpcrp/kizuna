export function expectedArtifactNames(name, version, arch = 'x86_64') {
  // electron-builder expands ${arch} to `x86_64` for AppImage and `amd64` for
  // deb — the token each packaging format itself uses, not a single value.
  const debArch = arch === 'x86_64' ? 'amd64' : arch
  return {
    appImage: `${name}-${version}-linux-${arch}.AppImage`,
    deb: `${name}-${version}-linux-${debArch}.deb`
  }
}

const STARTUP_PROBE_PREFIX = 'kizuna-startup-probe'

/**
 * @param {string} stdout
 * @returns {{ ready: boolean, milestones: string[] }}
 */
export function readStartupProbeOutcome(stdout) {
  const milestones = []
  let readyLine = false
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith(STARTUP_PROBE_PREFIX)) continue
    const detail = line.slice(STARTUP_PROBE_PREFIX.length).replace(/^:\s*/, '')
    if (detail === 'ready') readyLine = true
    else if (detail.startsWith('reached ')) milestones.push(detail.slice('reached '.length))
  }
  const ready =
    readyLine && ['window', 'mpv', 'renderer'].every((name) => milestones.includes(name))
  return { ready, milestones }
}
