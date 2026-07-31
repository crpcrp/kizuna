import { describe, expect, it, vi } from 'vitest'
import { defaultAnkiSettings, type AnkiSettings } from '@src/shared/anki'
import type { LookupResult } from '@src/shared/dictionary'
import type { Token } from '@src/shared/token'
import type { MiningCandidate, ResolvedEntry } from '@src/renderer/src/state/bulkMining'
import { runBulkMining, type BulkMineBridges } from '@src/renderer/src/state/bulkMiningRunner'
import { makeLookupResult } from '@test/harness/dictFixtures'

function token(lemma: string): Token {
  return {
    surface: `${lemma}-surface`,
    reading: `${lemma}-reading`,
    lemma,
    pos: 'noun',
    startOffset: 0
  }
}

function candidate(lemma: string): MiningCandidate {
  return { lemma, token: token(lemma), sentence: `${lemma} sentence`, count: 1 }
}

function entry(expression: string): LookupResult {
  return makeLookupResult({ expression, reading: '', glossary: '' })
}

function settings(overrides: Partial<AnkiSettings> = {}): AnkiSettings {
  return {
    ...defaultAnkiSettings,
    deckName: 'Deck',
    modelName: 'Model',
    fieldMap: { ...defaultAnkiSettings.fieldMap, word: 'Word' },
    ...overrides
  }
}

function bridges(
  overrides: Partial<BulkMineBridges['anki']> = {},
  lookup = vi.fn().mockResolvedValue([])
): BulkMineBridges {
  return {
    dict: { lookup },
    anki: {
      ping: vi.fn().mockResolvedValue({ ok: true }),
      getSettings: vi.fn().mockResolvedValue(settings()),
      findExisting: vi.fn().mockResolvedValue(null),
      addNote: vi
        .fn()
        .mockResolvedValue({ noteId: 1, operation: 'added', changedFields: ['Word'] }),
      ...overrides
    }
  }
}

describe('runBulkMining', () => {
  it('mines cached entries sequentially and reports each transition', async () => {
    const words = ['one', 'two', 'three'].map(candidate)
    const anki = bridges()
    const statuses: string[] = []
    const resolved = Object.fromEntries(
      words.map((word) => [word.lemma, { entry: entry(word.lemma), frequency: null }])
    ) as Record<string, ResolvedEntry>

    const result = await runBulkMining(anki, words, resolved, { current: 0 }, (lemma, status) =>
      statuses.push(`${lemma}:${status.kind}`)
    )

    expect(result).toEqual({
      kind: 'finished',
      statuses: { one: { kind: 'added' }, two: { kind: 'added' }, three: { kind: 'added' } }
    })
    expect(anki.anki.addNote).toHaveBeenCalledWith({
      token: words[0].token,
      result: entry('one'),
      sentence: 'one sentence'
    })
    expect(anki.anki.addNote).toHaveBeenCalledTimes(3)
    expect(statuses).toEqual([
      'one:mining',
      'one:added',
      'two:mining',
      'two:added',
      'three:mining',
      'three:added'
    ])
  })

  it('mines the resolved candidate result verbatim, frequency metadata included', async () => {
    const words = [candidate('one')]
    const anki = bridges()
    const resolvedEntry: LookupResult = {
      ...entry('one'),
      frequency: 12000,
      frequencyDisplay: '12k'
    }
    const resolved: Record<string, ResolvedEntry> = {
      one: { entry: resolvedEntry, frequency: 12000 }
    }

    await runBulkMining(anki, words, resolved, { current: 0 }, vi.fn())

    // The mine serializes the already-resolved result; no second lookup runs.
    expect(anki.anki.addNote).toHaveBeenCalledWith({
      token: words[0].token,
      result: resolvedEntry,
      sentence: 'one sentence'
    })
    expect(anki.dict.lookup).not.toHaveBeenCalled()
  })

  it('aborts before words for an unavailable or rejecting Anki ping', async () => {
    const unavailable = bridges({
      ping: vi.fn().mockResolvedValue({ ok: false, error: 'Anki is closed' })
    })
    await expect(
      runBulkMining(unavailable, [candidate('one')], {}, { current: 0 }, vi.fn())
    ).resolves.toEqual({ kind: 'aborted', message: 'Anki is closed' })
    expect(unavailable.anki.getSettings).not.toHaveBeenCalled()
    expect(unavailable.anki.addNote).not.toHaveBeenCalled()

    await expect(
      runBulkMining(
        bridges({ ping: vi.fn().mockRejectedValue(new Error('connection refused')) }),
        [candidate('one')],
        {},
        { current: 0 },
        vi.fn()
      )
    ).resolves.toEqual({ kind: 'aborted', message: 'connection refused' })
  })

  it.each(['deckName', 'modelName', 'word'] as const)(
    'aborts for a missing Anki %s configuration',
    async (missing) => {
      const configured = settings()
      const invalid =
        missing === 'word'
          ? { ...configured, fieldMap: { ...configured.fieldMap, word: '' } }
          : { ...configured, [missing]: '' }
      const anki = bridges({ getSettings: vi.fn().mockResolvedValue(invalid) })

      await expect(
        runBulkMining(anki, [candidate('one')], {}, { current: 0 }, vi.fn())
      ).resolves.toEqual({
        kind: 'aborted',
        message: 'Configure Anki deck, model, and Word field in Options → Anki.'
      })
      expect(anki.anki.addNote).not.toHaveBeenCalled()
    }
  )

  it('treats prevent-deck hits as duplicates and maps verified add or update operations exactly', async () => {
    const word = candidate('one')
    const next = candidate('two')
    const resolved = {
      one: { entry: entry('dictionary headword'), frequency: null },
      two: { entry: entry('next word'), frequency: null }
    }
    const prevent = bridges({
      findExisting: vi
        .fn()
        .mockResolvedValueOnce({ cardId: 4, deckNames: ['Core 2k', 'Japanese'] })
        .mockResolvedValueOnce(null)
    })
    await expect(
      runBulkMining(prevent, [word, next], resolved, { current: 0 }, vi.fn())
    ).resolves.toEqual({
      kind: 'finished',
      statuses: {
        one: { kind: 'duplicate', deckNames: ['Core 2k', 'Japanese'] },
        two: { kind: 'added' }
      }
    })
    expect(prevent.anki.addNote).toHaveBeenCalledTimes(1)

    for (const [duplicatePolicy, operation] of [
      ['allow', 'added'],
      ['overwrite', 'updated']
    ] as const) {
      const direct = bridges({
        getSettings: vi.fn().mockResolvedValue(settings({ duplicatePolicy })),
        addNote: vi.fn().mockResolvedValue({ noteId: 1, operation, changedFields: ['Word'] })
      })
      await expect(
        runBulkMining(direct, [word], resolved, { current: 0 }, vi.fn())
      ).resolves.toEqual({ kind: 'finished', statuses: { one: { kind: operation } } })
      expect(direct.anki.findExisting).not.toHaveBeenCalled()
    }
  })

  it('mines pre-resolved entries, marks rows without one as noEntry, and never looks up the dictionary', async () => {
    const lookup = vi.fn()
    const anki = bridges(
      { addNote: vi.fn().mockRejectedValue(new Error('deck unavailable')) },
      lookup
    )
    // 'missing' is absent from resolved entirely; 'null-entry' resolved to no entry.
    const words = [
      candidate('cached'),
      candidate('missing'),
      candidate('null-entry'),
      candidate('broken')
    ]
    const resolved: Record<string, ResolvedEntry> = {
      cached: { entry: entry('cached'), frequency: null },
      'null-entry': { entry: null, frequency: null },
      broken: { entry: entry('broken'), frequency: null }
    }
    const result = await runBulkMining(anki, words, resolved, { current: 0 }, vi.fn())

    expect(result).toEqual({
      kind: 'finished',
      statuses: {
        cached: { kind: 'error', message: 'deck unavailable' },
        missing: { kind: 'noEntry' },
        'null-entry': { kind: 'noEntry' },
        broken: { kind: 'error', message: 'deck unavailable' }
      }
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('keeps an in-flight outcome and cancels every remaining word', async () => {
    const cancelToken = { current: 9 }
    const words = ['one', 'two', 'three'].map(candidate)
    let addCount = 0
    const anki = bridges({
      addNote: vi.fn().mockImplementation(async () => {
        addCount++
        if (addCount === 2) cancelToken.current++
        return { noteId: addCount, operation: 'updated' as const, changedFields: ['Word'] }
      })
    })
    const resolved = Object.fromEntries(
      words.map((word) => [word.lemma, { entry: entry(word.lemma), frequency: null }])
    ) as Record<string, ResolvedEntry>

    const result = await runBulkMining(anki, words, resolved, cancelToken, vi.fn())

    expect(result).toEqual({
      kind: 'finished',
      statuses: { one: { kind: 'updated' }, two: { kind: 'updated' }, three: { kind: 'cancelled' } }
    })
    expect(anki.anki.addNote).toHaveBeenCalledTimes(2)
  })
})

describe('runBulkMining sentence-audio media context', () => {
  const source = { filePath: 'C:\\videos\\ep1.mkv', audioStreamIndex: 2, subtitleOffsetMs: 0 }

  function timedCandidate(lemma: string, cueStart?: number, cueEnd?: number): MiningCandidate {
    return { ...candidate(lemma), cueStart, cueEnd }
  }

  async function mine(
    words: MiningCandidate[],
    media?: Parameters<typeof runBulkMining>[5]
  ): Promise<BulkMineBridges> {
    const anki = bridges()
    const resolved = Object.fromEntries(
      words.map((word) => [word.lemma, { entry: entry(word.lemma), frequency: null }])
    ) as Record<string, ResolvedEntry>
    await runBulkMining(anki, words, resolved, { current: 0 }, vi.fn(), media)
    return anki
  }

  it('forms each candidate\u2019s window from its own first-occurrence cue timing', async () => {
    const anki = await mine(
      [timedCandidate('one', 10, 12), timedCandidate('two', 100, 101)],
      source
    )

    expect(anki.anki.addNote).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        media: {
          path: 'C:\\videos\\ep1.mkv',
          audioStreamIndex: 2,
          startSec: 9.75,
          endSec: 12.25
        }
      })
    )
    expect(anki.anki.addNote).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        media: expect.objectContaining({ startSec: 99.75, endSec: 101.25 })
      })
    )
  })

  it('applies the threaded subtitle offset to every candidate', async () => {
    const anki = await mine([timedCandidate('one', 10, 12)], {
      ...source,
      subtitleOffsetMs: -500
    })

    expect((anki.anki.addNote as ReturnType<typeof vi.fn>).mock.calls[0][0].media).toEqual(
      expect.objectContaining({ startSec: 9.25, endSec: 11.75 })
    )
  })

  it('omits the context when no media source was threaded through', async () => {
    const anki = await mine([timedCandidate('one', 10, 12)])

    expect((anki.anki.addNote as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty(
      'media'
    )
  })

  it('omits it only for the candidates whose cue carried no timing', async () => {
    const anki = await mine([timedCandidate('one'), timedCandidate('two', 10, 12)], source)

    const calls = (anki.anki.addNote as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).not.toHaveProperty('media')
    expect(calls[1][0].media).toEqual(expect.objectContaining({ startSec: 9.75 }))
  })

  it('omits it for a remote URL, which ffmpeg cannot clip', async () => {
    const anki = await mine([timedCandidate('one', 10, 12)], {
      ...source,
      filePath: 'https://www.youtube.com/watch?v=abc'
    })

    expect((anki.anki.addNote as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty(
      'media'
    )
  })
})
