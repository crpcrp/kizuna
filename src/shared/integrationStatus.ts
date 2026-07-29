// Shared bundled-binary status DTO, crossing main/preload/renderer. Pure data.
//
// Read-only diagnostics for the Options dialog's "Setup & integrations" tab:
// whether each optional bundled executable is actually on disk. Main resolves
// the paths (resourcePaths.ts) and probes them; the renderer never sees a path,
// only the booleans — a missing binary is a "download this" message, not
// something the UI can act on.

export interface BundledBinaryStatus {
  /** `resources/ffmpeg/ffmpeg.exe` — subtitle extraction, seek thumbnails. */
  ffmpeg: boolean
  /** `resources/ffmpeg/ffprobe.exe` — track enumeration, chapters, dimensions. */
  ffprobe: boolean
  /** `resources/yt-dlp/yt-dlp.exe` — URL streaming and online captions. */
  ytdlp: boolean
}
