import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createMecabService, mapWithConcurrency } from '@src/main/mecabBridge'
import { tokenize, tokenizeBatch, type MecabExec } from '@src/main/services/mecab/runner'
import { createSettingsStore } from '@src/main/services/settings'
import { fakeMecabSuccess, fakeMecabFailure } from '@test/harness/fakeMecab'
import { fixture } from '@test/paths'

const IPADIC_FIXTURE = readFileSync(fixture('mecab-ipadic.txt'), 'utf-8')
const UNIDIC_FIXTURE = readFileSync(fixture('mecab-unidic.txt'), 'utf-8')

describe('tokenize', () => {
  it('runs exec with -d <dicdir> and the input text, and parses the result', async () => {
    const fake = fakeMecabSuccess(IPADIC_FIXTURE)

    const tokens = await tokenize(
      {
        mecabPath: 'C:\\resources\\mecab\\mecab.exe',
        dicdir: 'C:\\resources\\mecab\\ipadic',
        flavor: 'ipadic'
      },
      '猫が魚を食べます。',
      fake.exec
    )

    expect(fake.calls).toEqual([
      {
        mecabPath: 'C:\\resources\\mecab\\mecab.exe',
        args: ['-d', 'C:\\resources\\mecab\\ipadic'],
        input: '猫が魚を食べます。'
      }
    ])
    expect(tokens).toHaveLength(6)
    expect(tokens[0]).toEqual({
      surface: '猫',
      reading: 'ネコ',
      lemma: '猫',
      pos: '名詞',
      startOffset: 0
    })
  })

  it('keeps omitted whitespace in the source offset space', async () => {
    const fake = fakeMecabSuccess(
      [
        '猫\t名詞,一般,*,*,*,*,猫,ネコ,ネコ',
        '大丈夫\t名詞,形容動詞語幹,*,*,*,*,大丈夫,ダイジョウブ,ダイジョーブ',
        'EOS'
      ].join('\n')
    )

    const tokens = await tokenize(
      {
        mecabPath: 'C:\\resources\\mecab\\mecab.exe',
        dicdir: 'C:\\resources\\mecab\\ipadic',
        flavor: 'ipadic'
      },
      '猫 大丈夫',
      fake.exec
    )

    expect(tokens.map(({ surface, startOffset }) => [surface, startOffset])).toEqual([
      ['猫', 0],
      ['大丈夫', 2]
    ])
  })

  it('threads the unidic flavor through to the parser', async () => {
    const fake = fakeMecabSuccess(UNIDIC_FIXTURE)

    const tokens = await tokenize(
      { mecabPath: 'mecab.exe', dicdir: 'unidic', flavor: 'unidic' },
      '猫が魚を食べます。',
      fake.exec
    )

    expect(tokens[3]).toEqual({
      surface: 'を',
      reading: 'オ',
      lemma: 'を',
      pos: '助詞',
      startOffset: 3
    })
  })

  it('propagates exec rejection unchanged', async () => {
    const fake = fakeMecabFailure(new Error('mecab exited 1'))

    await expect(
      tokenize({ mecabPath: 'mecab.exe', dicdir: 'ipadic', flavor: 'ipadic' }, 'text', fake.exec)
    ).rejects.toThrow('mecab exited 1')
  })
})

describe('tokenizeBatch', () => {
  const cfg = { mecabPath: 'mecab.exe', dicdir: 'ipadic', flavor: 'ipadic' as const }
  const node = (surface: string) => `${surface}\t名詞,一般,*,*,*,*,${surface},${surface},${surface}`
  const output = (...surfaces: string[]) => `${surfaces.map(node).join('\n')}\nEOS\n`

  it('matches per-cue output and ordering across batched and four fallback cues', async () => {
    const texts = ['猫', '二\n行', '', '犬', '三\n行', '四\n行', '鳥']
    const responses = new Map([
      ['猫', output('猫')],
      ['犬', output('犬')],
      ['鳥', output('鳥')],
      ['猫\n犬\n鳥', output('猫') + output('犬') + output('鳥')],
      ['二\n行', output('二', '行')],
      ['', 'EOS\n'],
      ['三\n行', output('三', '行')],
      ['四\n行', output('四', '行')]
    ])
    const calls: string[] = []
    const exec: MecabExec = async (path, args, input) => {
      calls.push(input)
      return fakeMecabSuccess(responses.get(input)!).exec(path, args, input)
    }
    const before = await mapWithConcurrency(texts, 2, (text) => tokenize(cfg, text, exec))
    calls.length = 0
    const after = await tokenizeBatch(cfg, texts, exec)

    expect(after).toEqual(before)
    expect(
      after.map((tokens) => tokens.map(({ surface, startOffset }) => [surface, startOffset]))
    ).toEqual([
      [['猫', 0]],
      [
        ['二', 0],
        ['行', 1]
      ],
      [],
      [['犬', 0]],
      [
        ['三', 0],
        ['行', 1]
      ],
      [
        ['四', 0],
        ['行', 1]
      ],
      [['鳥', 0]]
    ])
    expect(calls).toEqual(['猫\n犬\n鳥', '二\n行', '', '三\n行', '四\n行'])
  })

  it('keeps omitted whitespace in each batched cue offset space', async () => {
    const text = '猫 大丈夫'
    const tokens = await tokenizeBatch(cfg, [text], fakeMecabSuccess(output('猫', '大丈夫')).exec)

    expect(
      tokens.map((items) => items.map(({ surface, startOffset }) => [surface, startOffset]))
    ).toEqual([
      [
        ['猫', 0],
        ['大丈夫', 2]
      ]
    ])
  })

  it('runs the production service batch path through the injected MeCab exec', async () => {
    const fake = fakeMecabSuccess(output('猫') + output('犬'))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: 'ipadic' },
      exists: () => true,
      settings: createSettingsStore({ read: () => undefined, write: () => undefined }),
      mecabExec: fake.exec
    })

    expect((await service.tokenizeBatch(['猫', '犬'])).map((tokens) => tokens[0].surface)).toEqual([
      '猫',
      '犬'
    ])
    expect(fake.calls).toEqual([
      { mecabPath: 'mecab.exe', args: ['-d', 'ipadic'], input: '猫\n犬' }
    ])
  })

  it('rejects missing cue sections and non-blank trailing output', async () => {
    await expect(
      tokenizeBatch(cfg, ['猫', '犬'], fakeMecabSuccess(output('猫')).exec)
    ).rejects.toThrow('input cue count')
    await expect(
      tokenizeBatch(cfg, ['猫'], fakeMecabSuccess(output('猫') + 'trailing').exec)
    ).rejects.toThrow('input cue count')
  })

  it('reduces process-bound work for a whole track without changing output', async () => {
    const texts = Array.from({ length: 80 }, () => '猫')
    const oneResult = output('猫')
    const batchResult = oneResult.repeat(texts.length)
    const delayMs = 2
    const timedExec = (stdout: string) => {
      const fake = fakeMecabSuccess(stdout)
      return async (...args: Parameters<typeof fake.exec>) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        return fake.exec(...args)
      }
    }
    const before = () =>
      mapWithConcurrency(texts, 2, (text) => tokenize(cfg, text, timedExec(oneResult)))
    const after = () => tokenizeBatch(cfg, texts, timedExec(batchResult))
    const measure = async (run: () => Promise<unknown>) => {
      const samples: number[] = []
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        await run()
        samples.push(performance.now() - start)
      }
      return samples.sort((a, b) => a - b)[2]
    }

    await before()
    await after()
    const beforeMs = await measure(before)
    const afterMs = await measure(after)
    expect(afterMs).toBeLessThan(beforeMs / 5)
    console.log(
      `mecab-batch benchmark: warmup=1 reps=5 cues=80 delay=${delayMs}ms ` +
        `before=${beforeMs.toFixed(1)}ms after=${afterMs.toFixed(1)}ms`
    )
  })
})
