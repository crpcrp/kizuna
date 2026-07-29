// Renderer-side orchestration
// for the Subtitle menu's "Online subtitles" section. Framework-agnostic and
// directly unit-testable: a subscribable store (same shape as
// recentFilesController/popupController) driven by an injected bridge, cue sink
// and warning reporter. No React, no `window`, no Electron here.
//
// Async safety uses two monotonic counters, mirroring `SubtitleRequestToken`
// in playerActions:
//   • `generation` — bumped on every `load` and `dispose`. Gates inventory
//     enumeration *and* acquisition, so a URL change or unmount discards every
//     older async result.
//   • `selectionToken` — bumped additionally on every `select`/`selectOff`.
//     Gates acquisition, so a newer selection (or Off) discards an older
//     in-flight acquisition and its cue injection.

import { isExtractorBackedUrl } from '../../../shared/ytdlpQuality'
import type {
  UrlSubtitleAsset,
  UrlSubtitleDescriptor,
  UrlSubtitleInventory,
  UrlSubtitleKind,
  UrlSubtitleTrack
} from '../../../shared/urlSubtitles'

/** Non-blocking warning shown when inventory enumeration fails. */
export const URL_SUBTITLE_INVENTORY_ERROR = 'Online subtitles could not be loaded.'
/** Non-blocking warning shown when a selected track's acquisition fails. */
export const URL_SUBTITLE_ACQUIRE_ERROR = 'The selected online subtitle could not be loaded.'

/** The Online-subtitles section's render state. */
export type UrlSubtitleMenuState =
  /** Not an extractor-backed URL: the whole section is hidden. */
  | { status: 'hidden' }
  /** Enumeration is in flight. */
  | { status: 'loading' }
  /** Enumeration finished with no usable tracks, or failed. */
  | { status: 'unavailable' }
  /** Enumeration produced a track catalog. */
  | { status: 'ready'; tracks: UrlSubtitleTrack[] }

/** The full store state the renderer subscribes to. */
export interface UrlSubtitleState {
  menu: UrlSubtitleMenuState
  /** The acquired track's `selectionId`, or null for Off (default). */
  selectedId: string | null
  /** `selectionId` of the track whose acquisition is in flight, or null. */
  acquiring: string | null
}

const INITIAL_STATE: UrlSubtitleState = {
  menu: { status: 'hidden' },
  selectedId: null,
  acquiring: null
}

/** The preload surface the controller drives (see `window.kizuna.urlSubtitles`). */
export interface UrlSubtitleBridge {
  enumerate(url: string): Promise<UrlSubtitleInventory>
  acquire(descriptor: UrlSubtitleDescriptor): Promise<UrlSubtitleAsset>
  cancel(): void
}

/** Where a successfully acquired (or cleared) track's cues go — App wires this
 * to the same reducer path external/local subtitle selection uses. */
export interface UrlSubtitleSink {
  injectCues(asset: UrlSubtitleAsset): void
  clear(): void
}

export interface UrlSubtitleControllerDeps {
  bridge: UrlSubtitleBridge
  sink: UrlSubtitleSink
  onWarning: (message: string) => void
  /** Read fresh on every enumeration — the setting can change at runtime, so
   * it must never be cached at controller-creation time. */
  preferredLanguage: () => string
}

export interface UrlSubtitleController {
  getState(): UrlSubtitleState
  subscribe(listener: () => void): () => void
  /**
   * Begins a per-load lifecycle for `url`. Invalidates any older enumeration/
   * acquisition, resets the selection to Off, and — for an extractor-backed URL
   * — starts async enumeration without blocking. A non-extractor URL (or
   * undefined) hides the section. Does not touch the cue sink: the caller's own
   * `fileLoaded` reset already cleared cues for a new file.
   */
  load(url: string | undefined): void
  /** Turns the online subtitle off: clears cues, cancels any acquisition, and
   * invalidates older async results. */
  selectOff(): void
  /** Acquires the given track and, on success, injects its cues. Keeps the
   * previously displayed cues if acquisition fails. Ignores an unknown id or a
   * non-ready menu. */
  select(selectionId: string): void
  /** App-cleanup: invalidates all pending async work and aborts the bridge. */
  dispose(): void
}

// ---- Pure helpers (menu ordering / labels) ---------------------------------

/**
 * Stable, locale-independent order within a kind group: by menu label, then
 * language code, then `selectionId`, all by JS string (UTF-16 code-unit)
 * comparison — never `localeCompare`, so the order never shifts with locale.
 */
export function compareUrlSubtitleTracks(a: UrlSubtitleTrack, b: UrlSubtitleTrack): number {
  if (a.label !== b.label) return a.label < b.label ? -1 : 1
  if (a.lang !== b.lang) return a.lang < b.lang ? -1 : 1
  if (a.selectionId === b.selectionId) return 0
  return a.selectionId < b.selectionId ? -1 : 1
}

/**
 * Menu row order: every provided track (sorted) first, then every auto track
 * (sorted). Provided and auto are never merged, so an equal-language provided
 * and auto track both survive as distinct rows.
 */
export function orderedUrlSubtitleTracks(tracks: UrlSubtitleTrack[]): UrlSubtitleTrack[] {
  const provided = tracks.filter((t) => t.kind === 'provided').sort(compareUrlSubtitleTracks)
  const auto = tracks.filter((t) => t.kind === 'auto').sort(compareUrlSubtitleTracks)
  return [...provided, ...auto]
}

/** Pure. How well a track matches a preferred language code:
 *  2 = exact (case-insensitive) `lang` match, 1 = primary-subtag match
 *  (`pt-BR` vs `pt`), 0 = no match. An empty preference always scores 0. */
export function urlSubtitleLanguageMatch(track: UrlSubtitleTrack, preferred: string): number {
  if (preferred === '') return 0
  const p = preferred.toLowerCase()
  const lang = track.lang.toLowerCase()
  if (lang === p) return 2
  if (lang.split('-')[0] === p.split('-')[0]) return 1
  return 0
}

/** Pure. `orderedUrlSubtitleTracks`, but every track matching `preferred` is
 *  hoisted above the rest. Within the hoisted group: higher match score first,
 *  then provided before auto, then `compareUrlSubtitleTracks`. The unmatched
 *  remainder keeps `orderedUrlSubtitleTracks`' existing order verbatim. */
export function orderedUrlSubtitleTracksForPreference(
  tracks: UrlSubtitleTrack[],
  preferred: string
): UrlSubtitleTrack[] {
  if (preferred === '') return orderedUrlSubtitleTracks(tracks)
  const matched = tracks.filter((t) => urlSubtitleLanguageMatch(t, preferred) > 0)
  const unmatchedIds = new Set(
    tracks.filter((t) => urlSubtitleLanguageMatch(t, preferred) === 0).map((t) => t.selectionId)
  )
  const remainder = orderedUrlSubtitleTracks(tracks).filter((t) => unmatchedIds.has(t.selectionId))
  matched.sort((a, b) => {
    const scoreDiff =
      urlSubtitleLanguageMatch(b, preferred) - urlSubtitleLanguageMatch(a, preferred)
    if (scoreDiff !== 0) return scoreDiff
    if (a.kind !== b.kind) return a.kind === 'provided' ? -1 : 1
    return compareUrlSubtitleTracks(a, b)
  })
  return [...matched, ...remainder]
}

/** Pure. The track that should be auto-selected for `preferred`, or undefined.
 *  Highest match score wins; provided beats auto at equal score; ties broken by
 *  `compareUrlSubtitleTracks`. */
export function autoSelectUrlSubtitleTrack(
  tracks: UrlSubtitleTrack[],
  preferred: string
): UrlSubtitleTrack | undefined {
  return orderedUrlSubtitleTracksForPreference(tracks, preferred).find(
    (t) => urlSubtitleLanguageMatch(t, preferred) > 0
  )
}

/** Above this many tracks the Online-subtitles section shows a filter box. */
export const URL_SUBTITLE_FILTER_THRESHOLD = 8

/** Pure. Case-insensitive substring filter over a track's display label and
 *  its raw language code. A blank/whitespace-only query matches everything.
 *  Never reorders — callers filter the already-ordered list. */
export function filterUrlSubtitleTracks(
  tracks: UrlSubtitleTrack[],
  query: string
): UrlSubtitleTrack[] {
  const q = query.trim().toLowerCase()
  if (q === '') return tracks
  return tracks.filter(
    (t) => urlSubtitleRowLabel(t).toLowerCase().includes(q) || t.lang.toLowerCase().includes(q)
  )
}

/** The visible source badge for a track's kind. */
export function urlSubtitleBadgeLabel(kind: UrlSubtitleKind): string {
  return kind === 'auto' ? 'Auto-generated' : 'Provided'
}

/**
 * The row's language label. Auto tracks' `label` carries a redundant
 * " (auto-generated)" suffix (the kind is already shown as a badge), so it is
 * stripped for display.
 */
export function urlSubtitleRowLabel(track: UrlSubtitleTrack): string {
  return track.kind === 'auto' ? track.label.replace(/ \(auto-generated\)$/, '') : track.label
}

// ---- Controller ------------------------------------------------------------

export function createUrlSubtitleController(
  deps: UrlSubtitleControllerDeps
): UrlSubtitleController {
  const { bridge, sink, onWarning, preferredLanguage } = deps
  let state: UrlSubtitleState = INITIAL_STATE
  const listeners = new Set<() => void>()
  // The URL the current (extractor-backed) inventory belongs to; acquisition
  // re-derives its descriptor from this, never from a caller-supplied string.
  let currentUrl: string | undefined
  let generation = 0
  let selectionToken = 0

  function set(patch: Partial<UrlSubtitleState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  async function runEnumerate(url: string, gen: number): Promise<void> {
    let inventory: UrlSubtitleInventory
    try {
      inventory = await bridge.enumerate(url)
    } catch {
      if (gen !== generation) return
      set({ menu: { status: 'unavailable' } })
      onWarning(URL_SUBTITLE_INVENTORY_ERROR)
      return
    }
    if (gen !== generation) return
    if (inventory.available && inventory.tracks.length > 0) {
      set({ menu: { status: 'ready', tracks: inventory.tracks } })
      const target = autoSelectUrlSubtitleTrack(inventory.tracks, preferredLanguage())
      if (target) {
        selectionToken += 1
        set({ acquiring: target.selectionId })
        void runAcquire(url, target.selectionId, null, gen, selectionToken, true)
      }
    } else {
      set({ menu: { status: 'unavailable' } })
    }
  }

  async function runAcquire(
    url: string,
    selectionId: string,
    previous: string | null,
    gen: number,
    token: number,
    silent = false
  ): Promise<void> {
    const stale = (): boolean => gen !== generation || token !== selectionToken
    try {
      const asset = await bridge.acquire({ url, selectionId })
      if (stale()) return
      sink.injectCues(asset)
      set({ selectedId: selectionId, acquiring: null })
    } catch (err) {
      if (stale()) return
      // Retain the previously displayed cues and selection; only warn.
      set({ selectedId: previous, acquiring: null })
      if (!silent) {
        const message =
          typeof err === 'object' &&
          err !== null &&
          'message' in err &&
          typeof err.message === 'string' &&
          err.message.trim() !== ''
            ? err.message
            : URL_SUBTITLE_ACQUIRE_ERROR
        onWarning(message)
      }
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    load(url) {
      generation += 1
      selectionToken += 1
      bridge.cancel()
      if (!isExtractorBackedUrl(url)) {
        currentUrl = undefined
        set({ menu: { status: 'hidden' }, selectedId: null, acquiring: null })
        return
      }
      currentUrl = url
      set({ menu: { status: 'loading' }, selectedId: null, acquiring: null })
      void runEnumerate(url, generation)
    },

    selectOff() {
      selectionToken += 1
      bridge.cancel()
      set({ selectedId: null, acquiring: null })
      sink.clear()
    },

    select(selectionId) {
      if (state.menu.status !== 'ready') return
      if (!state.menu.tracks.some((track) => track.selectionId === selectionId)) return
      if (currentUrl === undefined) return
      const previous = state.selectedId
      selectionToken += 1
      // The chosen row shows an "acquiring" indicator, but the checked/selected
      // row stays put until the cues actually swap in on success — so a failed
      // acquisition leaves the previously displayed track selected.
      set({ acquiring: selectionId })
      void runAcquire(currentUrl, selectionId, previous, generation, selectionToken, false)
    },

    dispose() {
      generation += 1
      selectionToken += 1
      bridge.cancel()
    }
  }
}
