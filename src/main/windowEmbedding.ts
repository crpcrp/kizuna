interface CommandLineApp {
  commandLine: {
    appendSwitch(name: string, value?: string): void
  }
}

/**
 * Forces Linux onto X11 before the first BrowserWindow is created. mpv's
 * `--wid` embedding targets an X11 window; native Wayland embedding is out of
 * scope for this spike.
 */
export function configureLinuxX11(
  electronApp: CommandLineApp,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform === 'linux') electronApp.commandLine.appendSwitch('ozone-platform', 'x11')
}
