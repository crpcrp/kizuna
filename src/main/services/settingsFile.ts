import type { SettingsIO } from './settings'

export interface SettingsFileSystem {
  readFileSync(path: string, encoding: 'utf-8'): string
  writeFileSync(path: string, contents: string, encoding: 'utf-8'): void
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
}

/**
 * Builds the disk boundary for the settings store. Each update is written to a
 * sibling temporary file first, then atomically replaced with `renameSync`.
 */
export function createSettingsFile(settingsPath: string, fs: SettingsFileSystem): SettingsIO {
  const temporaryPath = `${settingsPath}.tmp`

  return {
    read(): string | undefined {
      try {
        return fs.readFileSync(settingsPath, 'utf-8')
      } catch {
        return undefined
      }
    },
    write(contents: string): void {
      try {
        fs.writeFileSync(temporaryPath, contents, 'utf-8')
        fs.renameSync(temporaryPath, settingsPath)
      } catch (error) {
        try {
          fs.unlinkSync(temporaryPath)
        } catch {
          // Cleanup is best-effort; the persistence failure remains primary.
        }
        throw error
      }
    }
  }
}
