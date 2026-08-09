import { describe, it, expect } from 'vitest'
import {
  expectedArtifactNames,
  parseDebContents,
  parseDebControl,
  parseDebDepends,
  parseDesktopEntry,
  permissionsFromSymbolicMode,
  readStartupProbeOutcome,
  REQUIRED_EXECUTABLE_PATHS,
  REQUIRED_ARCHIVE_PATHS,
  verifyArchivePaths,
  verifyDebControl,
  verifyDesktopEntry,
  verifyExecutableModes
} from '@scripts/linuxPackaging.mjs'
import {
  createStartupProbe,
  STARTUP_MILESTONES,
  type StartupMilestone
} from '@src/main/startupProbe'

describe('expectedArtifactNames', () => {
  // electron-builder expands ${arch} per packaging format, so the two names
  // legitimately disagree on the architecture token.
  it('carries platform and architecture in both names', () => {
    expect(expectedArtifactNames('kizuna', '1.2.3')).toEqual({
      appImage: 'kizuna-1.2.3-linux-x86_64.AppImage',
      deb: 'kizuna-1.2.3-linux-amd64.deb'
    })
  })
})

describe('parseDebControl', () => {
  it('reads fields and folds continuation lines', () => {
    const fields = parseDebControl(
      [
        'Package: kizuna',
        'Version: 0.1.0',
        'Architecture: amd64',
        'Depends: libgtk-3-0, mpv (= 0.37.0-1ubuntu4)',
        'Description: Video player',
        ' Longer text that wrapped',
        'Homepage: https://example.invalid/kizuna'
      ].join('\n')
    )

    expect(fields.Package).toBe('kizuna')
    expect(fields.Version).toBe('0.1.0')
    expect(fields.Description).toBe('Video player\nLonger text that wrapped')
    expect(fields.Homepage).toBe('https://example.invalid/kizuna')
  })
})

describe('parseDebDepends', () => {
  it('keeps version constraints and alternatives intact', () => {
    expect(parseDebDepends('libgtk-3-0, mpv (= 0.37.0-1ubuntu4), libjack-0 | libjack-1')).toEqual([
      'libgtk-3-0',
      'mpv (= 0.37.0-1ubuntu4)',
      'libjack-0 | libjack-1'
    ])
  })

  it('returns nothing for an empty field', () => {
    expect(parseDebDepends('')).toEqual([])
  })
})

describe('verifyDebControl', () => {
  const expected = {
    packageName: 'kizuna',
    version: '0.1.0',
    homepage: 'https://github.com/crpcrp/kizuna',
    requiredDepends: ['mpv (= 0.37.0-1ubuntu4)', 'ffmpeg (= 7:6.1.1-3ubuntu5)']
  }

  const good = {
    Package: 'kizuna',
    Version: '0.1.0',
    Architecture: 'amd64',
    Maintainer: 'Adam Kocsis <someone@example.invalid>',
    Homepage: 'https://github.com/crpcrp/kizuna',
    Depends: 'libgtk-3-0, mpv (= 0.37.0-1ubuntu4), ffmpeg (= 7:6.1.1-3ubuntu5)'
  }

  it('accepts a package that matches the packaging config', () => {
    expect(verifyDebControl(good, expected)).toEqual([])
  })

  // The whole point of pinning: a range would let the package install against
  // a library set the bundled mpv was not built for.
  it('rejects a relaxed dependency pin', () => {
    const problems = verifyDebControl(
      { ...good, Depends: 'libgtk-3-0, mpv (>= 0.37), ffmpeg (= 7:6.1.1-3ubuntu5)' },
      expected
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('mpv (= 0.37.0-1ubuntu4)')
  })

  it('rejects a maintainer without an address', () => {
    const problems = verifyDebControl({ ...good, Maintainer: 'Adam Kocsis' }, expected)
    expect(problems).toEqual([expect.stringContaining('not a "Name <email>" address')])
  })

  it('rejects a version or architecture that drifted from the package', () => {
    const problems = verifyDebControl({ ...good, Version: '9.9.9', Architecture: 'i386' }, expected)
    expect(problems).toHaveLength(2)
  })
})

describe('permissionsFromSymbolicMode', () => {
  it.each([
    ['-rwxr-xr-x', 0o755],
    ['-rw-r--r--', 0o644],
    ['drwxr-xr-x', 0o755],
    ['-rwx------', 0o700]
  ])('reads %s', (symbolic, expected) => {
    expect(permissionsFromSymbolicMode(symbolic)).toBe(expected)
  })

  it('returns undefined for a non-mode string', () => {
    expect(permissionsFromSymbolicMode('not-a-mode')).toBeUndefined()
  })
})

describe('parseDebContents', () => {
  const contents = [
    'drwxr-xr-x root/root         0 2026-08-09 10:00 ./',
    'drwxr-xr-x root/root         0 2026-08-09 10:00 ./opt/',
    'drwxr-xr-x root/root         0 2026-08-09 10:00 ./opt/Kizuna/',
    '-rwxr-xr-x root/root 165000000 2026-08-09 10:00 ./opt/Kizuna/kizuna',
    '-rw-r--r-- root/root  50000000 2026-08-09 10:00 ./opt/Kizuna/resources/app.asar',
    '-rwxr-xr-x root/root  30000000 2026-08-09 10:00 ./opt/Kizuna/resources/mpv/mpv',
    '-rw-r--r-- root/root      1024 2026-08-09 10:00 ./usr/share/applications/kizuna.desktop',
    '-rw-r--r-- root/root      7445 2026-08-09 10:00 ./usr/share/icons/hicolor/512x512/apps/kizuna.png'
  ].join('\n')

  it('splits application paths from desktop integration paths', () => {
    const { appPaths, appModes, otherPaths } = parseDebContents(contents, '/opt/Kizuna')

    expect(appPaths).toContain('resources/mpv/mpv')
    expect(appPaths).toContain('kizuna')
    expect(appModes['resources/mpv/mpv']).toBe(0o755)
    expect(appModes['resources/app.asar']).toBe(0o644)
    expect(otherPaths).toContain('/usr/share/applications/kizuna.desktop')
    expect(otherPaths).toContain('/usr/share/icons/hicolor/512x512/apps/kizuna.png')
  })

  it('keeps a symlink entry under its own path', () => {
    const { appPaths } = parseDebContents(
      'lrwxrwxrwx root/root 0 2026-08-09 10:00 ./opt/Kizuna/resources/mecab/lib/libmecab.so.2 -> ./libmecab.so.2.0.0',
      '/opt/Kizuna'
    )
    expect(appPaths).toEqual(['resources/mecab/lib/libmecab.so.2'])
  })
})

describe('verifyArchivePaths', () => {
  // `resources/notices` is a directory, so the listing carries its children.
  const listing = [
    ...REQUIRED_ARCHIVE_PATHS.filter((path) => path !== 'resources/notices'),
    'resources/notices/THIRD_PARTY_NOTICES.md',
    'resources/mecab/ipadic/matrix.bin'
  ]

  it('accepts a complete Linux tree', () => {
    expect(verifyArchivePaths(listing)).toEqual([])
  })

  it('accepts leading ./ from an archive listing', () => {
    expect(verifyArchivePaths(listing.map((path) => `./${path}`))).toEqual([])
  })

  it('reports a missing runtime resource', () => {
    const problems = verifyArchivePaths(listing.filter((path) => path !== 'resources/mpv/mpv'))
    expect(problems).toEqual([expect.stringContaining('resources/mpv/mpv')])
  })

  // Staging validation already refuses foreign-platform files, but a packaging
  // config that bundled `resources/` from a Windows checkout would slip past it.
  it.each(['resources/mpv/mpv.exe', 'resources/mecab/libmecab.dll'])(
    'reports the Windows binary %s',
    (foreign) => {
      const problems = verifyArchivePaths([...listing, foreign])
      expect(problems).toEqual([expect.stringContaining(foreign)])
    }
  )
})

describe('verifyExecutableModes', () => {
  const executable = Object.fromEntries(REQUIRED_EXECUTABLE_PATHS.map((path) => [path, 0o755]))

  it('accepts tools that kept the executable bit', () => {
    expect(verifyExecutableModes(executable)).toEqual([])
  })

  it('reports a tool that lost the executable bit in packaging', () => {
    const problems = verifyExecutableModes({ ...executable, 'resources/mpv/mpv': 0o644 })
    expect(problems).toEqual([expect.stringContaining('resources/mpv/mpv')])
  })

  it('reports a tool missing from the package', () => {
    const modes = { ...executable }
    delete modes['resources/mecab/bin/mecab.bin']
    expect(verifyExecutableModes(modes)).toEqual([
      expect.stringContaining('resources/mecab/bin/mecab.bin')
    ])
  })
})

describe('parseDesktopEntry', () => {
  it('reads the [Desktop Entry] group and ignores later groups', () => {
    const entry = parseDesktopEntry(
      [
        '# a comment',
        '[Desktop Entry]',
        'Name=Kizuna',
        'Exec=/opt/Kizuna/kizuna %U',
        'Categories=AudioVideo;Video;Player;',
        '',
        '[Desktop Action NewWindow]',
        'Name=New Window'
      ].join('\n')
    )

    expect(entry.Name).toBe('Kizuna')
    expect(entry.Exec).toBe('/opt/Kizuna/kizuna %U')
    // The action group's Name must not overwrite the entry's.
    expect(Object.keys(entry)).toEqual(['Name', 'Exec', 'Categories'])
  })
})

describe('verifyDesktopEntry', () => {
  const expected = {
    productName: 'Kizuna',
    executableName: 'kizuna',
    wmClass: 'kizuna',
    requiredMimeTypes: ['video/x-matroska', 'video/mp4'],
    requiredCategories: ['AudioVideo', 'Video', 'Player']
  }

  const good = {
    Name: 'Kizuna',
    Type: 'Application',
    Exec: '/opt/Kizuna/kizuna %U',
    Icon: 'kizuna',
    StartupWMClass: 'kizuna',
    Categories: 'AudioVideo;Video;Player;Education;',
    MimeType: 'video/x-matroska;video/mp4;video/webm;'
  }

  it('accepts a fully integrated entry', () => {
    expect(verifyDesktopEntry(good, expected)).toEqual([])
  })

  // Without a file placeholder the associations register but never deliver.
  it('rejects an Exec that takes no file argument', () => {
    const problems = verifyDesktopEntry({ ...good, Exec: '/opt/Kizuna/kizuna' }, expected)
    expect(problems).toEqual([expect.stringContaining('accepts no file or URL argument')])
  })

  // A mismatched WM class is the classic "generic icon in the dash" bug.
  it('rejects a StartupWMClass that does not match the desktop name', () => {
    const problems = verifyDesktopEntry({ ...good, StartupWMClass: 'Kizuna' }, expected)
    expect(problems).toEqual([expect.stringContaining('StartupWMClass')])
  })

  it('reports a missing MIME type and a missing category', () => {
    const problems = verifyDesktopEntry(
      { ...good, MimeType: 'video/mp4;', Categories: 'AudioVideo;Video;' },
      expected
    )
    expect(problems).toHaveLength(2)
  })

  it('rejects an entry with no icon', () => {
    const problems = verifyDesktopEntry({ ...good, Icon: '' }, expected)
    expect(problems).toEqual([expect.stringContaining('Icon')])
  })
})

describe('readStartupProbeOutcome', () => {
  /** Drives the real probe so the parser is tested against its actual output. */
  function probeOutput(marks: StartupMilestone[], timeout: boolean): string {
    const lines: string[] = []
    let fire: (() => void) | undefined
    const probe = createStartupProbe({
      enabled: true,
      log: (line) => lines.push(line),
      finish: () => {},
      setTimeoutFn: (cb) => {
        fire = cb
        return 'timer'
      },
      clearTimeoutFn: () => {}
    })
    for (const mark of marks) probe.mark(mark)
    if (timeout) fire?.()
    return lines.join('\n')
  }

  // The script and the app agree on a wire format neither imports from the
  // other (one is ESM tooling, the other is bundled TypeScript), so the
  // contract is pinned by feeding the parser the real thing.
  it('reads a successful launch produced by the application itself', () => {
    const outcome = readStartupProbeOutcome(probeOutput([...STARTUP_MILESTONES], false))

    expect(outcome.ready).toBe(true)
    expect(outcome.timedOut).toBe(false)
    expect(outcome.milestones).toEqual([...STARTUP_MILESTONES])
  })

  it('reads a timed-out launch produced by the application itself', () => {
    const outcome = readStartupProbeOutcome(probeOutput(['window'], true))

    expect(outcome.ready).toBe(false)
    expect(outcome.timedOut).toBe(true)
    expect(outcome.milestones).toEqual(['window'])
  })

  it('ignores unrelated Chromium and mpv output around the probe lines', () => {
    const stdout = [
      '[1:0809/100000.000:ERROR:viz_main_impl.cc(186)] Exiting GPU process',
      'kizuna-startup-probe: reached window',
      'AL lib: (EE) ALCplaybackAlsa_open: Could not open playback device',
      'kizuna-startup-probe: reached mpv',
      'kizuna-startup-probe: reached renderer',
      'kizuna-startup-probe: ready'
    ].join('\n')

    expect(readStartupProbeOutcome(stdout)).toEqual({
      ready: true,
      timedOut: false,
      milestones: ['window', 'mpv', 'renderer']
    })
  })

  it('reports nothing ready for output with no probe lines', () => {
    expect(readStartupProbeOutcome('Segmentation fault')).toEqual({
      ready: false,
      timedOut: false,
      milestones: []
    })
  })
})
