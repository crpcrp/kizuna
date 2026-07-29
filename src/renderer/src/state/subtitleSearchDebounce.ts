export interface SearchTimer {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export const browserSearchTimer: SearchTimer = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number)
}

/** Owns one pending subtitle-search commit. The injected timer keeps the
 * scheduling contract testable without a browser or real clock. */
export class SubtitleSearchDebounce {
  private handle: unknown
  private generation = 0

  constructor(
    private readonly commit: (query: string) => void,
    private readonly timer: SearchTimer = browserSearchTimer,
    private readonly delayMs = 200
  ) {}

  update(query: string): void {
    this.cancel()
    if (query.trim().length === 0) {
      this.commit('')
      return
    }

    const generation = this.generation
    this.handle = this.timer.set(() => {
      if (generation !== this.generation) return
      this.handle = undefined
      this.commit(query)
    }, this.delayMs)
  }

  flush(query: string): void {
    this.cancel()
    this.commit(query)
  }

  cancel(): void {
    this.generation += 1
    if (this.handle !== undefined) {
      this.timer.clear(this.handle)
      this.handle = undefined
    }
  }
}
