// CommonJS is loaded by electron-builder before the TypeScript build.

const identity = require('./src/shared/appIdentity.json')

module.exports = {
  appId: identity.appId,
  productName: identity.productName,
  // Keep the executable name independent of display-name capitalization.
  executableName: identity.executableName,
  directories: {
    output: 'dist'
  },
  // Generate updater metadata; publishing remains disabled by the dist commands.
  publish: [
    {
      provider: 'github',
      owner: 'crpcrp',
      repo: 'kizuna',
      channel: 'latest',
      releaseType: 'prerelease'
    }
  ],
  // The updater service must use this generation of electron-updater or newer.
  electronUpdaterCompatibility: '>=6.8.9',

  artifactName: '${name}-${version}-setup.${ext}',
  files: ['out/**/*'],
  // Koffi requires its native binary by absolute path; .node files cannot load from asar.
  asarUnpack: ['**/node_modules/@koromix/**'],
  extraResources: [
    { from: 'resources/mpv', to: 'mpv' },
    { from: 'resources/ffmpeg', to: 'ffmpeg' },
    { from: 'resources/mecab', to: 'mecab' },
    { from: 'resources/icons', to: 'icons' },
    // Bundled GPL mpv/FFmpeg require licence texts and a source offer, generated before packaging.
    { from: 'build/notices', to: 'notices' }
  ],
  win: {
    target: 'nsis',
    // Platform resources append to shared resources; keep the Windows-only OCR runtime out of Linux packages.
    extraResources: [{ from: 'resources/ppocr', to: 'ppocr' }],
    // Local builds remain unsigned when no certificate is provided.
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://timestamp.digicert.com'
    }
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  },
  linux: {
    // The pinned Linux payload supports x86-64 only.
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],

    icon: 'build/icon.png',
    // fpm requires a contactable maintainer; package.json supplies only a name.
    maintainer: 'Adam Kocsis <kocsisadam1991@gmail.com>',

    artifactName: '${name}-${version}-linux-${arch}.${ext}',
    // electron-builder overwrites desktop.entry categories with this value.
    category: 'AudioVideo;Video;Player;Education',
    // mpv embeds through X11 --wid; force X11 so Wayland launches use XWayland.
    executableArgs: ['--ozone-platform=x11'],
    synopsis: 'Video player for Japanese language learning',
    description:
      'Kizuna plays local video with mpv, tokenizes Japanese subtitles with MeCab, ' +
      'looks words up in Yomitan dictionaries, and mines vocabulary into Anki.',
    // Explicit MIME types avoid electron-builder registering private application/x-ext-* types.
    mimeTypes: [
      'video/x-matroska',
      'video/mp4',
      'video/webm',
      'video/x-msvideo',
      'video/quicktime'
    ],
    // Match Electron's desktopName-derived WM_CLASS so desktops group windows under the installed launcher.
    syncDesktopName: true,
    desktop: {
      entry: {
        GenericName: 'Video Player',
        Keywords: 'video;player;japanese;subtitles;mpv;anki;language;'
      }
    }
  },
  appImage: {
    // AppImage cannot install the setuid sandbox helper; retain its default flag alongside the X11 override.
    executableArgs: ['--no-sandbox', '--ozone-platform=x11']
  },
  deb: {
    // This replaces electron-builder's dependency list, so Electron runtime dependencies must be repeated.
    depends: [
      'libgtk-3-0',
      'libnotify4',
      'libnss3',
      'libxss1',
      'libxtst6',
      'xdg-utils',
      'libatspi2.0-0',
      'libuuid1',
      'libsecret-1-0',
      // Exact Ubuntu package pins prevent partial upgrades breaking bundled mpv/FFmpeg shared-library loading.
      'mpv (= 0.37.0-1ubuntu4)',
      'ffmpeg (= 7:6.1.1-3ubuntu5)'
    ]
  },
  fileAssociations: [
    {
      ext: ['mkv', 'mp4', 'webm', 'avi', 'mov'],
      name: 'Video',
      role: 'Viewer'
    }
  ]
}
