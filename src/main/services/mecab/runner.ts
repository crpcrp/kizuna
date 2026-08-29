// Harnessed MeCab runner: spawns mecab (or, in tests, an injected fake) and
// turns the result into `Token[]` via buildMecabArgs + parseMecab. Mirrors
// ffprobe.ts/ffmpeg.ts's Exec-injection pattern — see
// test/harness/fakeMecab.ts.

import { execFile } from 'node:child_process'
import type { DictFlavor, Token } from '../../../shared/token'
import { buildMecabArgs } from './mecabArgs'
import { parseMecab } from './parseMecab'

/**
 * Runs MeCab with `input` piped to stdin and returns its stdout. Injected
 * into `tokenize` so tests can supply a fake instead of spawning a real
 * process.
 */
export type MecabExec = (mecabPath: string, args: string[], input: string) => Promise<string>

/**
 * Real production exec: shells out to mecab via `execFile`, writing `input`
 * to stdin and reading stdout, both as UTF-8. Never exercised by tests —
 * only wired in at runtime.
 */
export const execMecab: MecabExec = (mecabPath, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      mecabPath,
      args,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(stdout)
      }
    )
    child.stdin?.end(input, 'utf-8')
  })

export interface MecabConfig {
  mecabPath: string
  dicdir: string
  flavor: DictFlavor
}

/**
 * Tokenizes `text` via the injected `exec`: builds argv for `cfg.dicdir`,
 * runs mecab against `text`, and parses the resulting stdout with
 * `cfg.flavor`'s feature-column layout. If `exec` rejects (e.g. mecab
 * missing or exits non-zero), the rejection propagates unchanged.
 */
export async function tokenize(
  cfg: MecabConfig,
  text: string,
  exec: MecabExec = execMecab
): Promise<Token[]> {
  const stdout = await exec(cfg.mecabPath, buildMecabArgs(cfg.dicdir), text)
  return parseMecab(cfg.flavor, stdout, text)
}

/** Batches single-line cues; empty or multiline cues retain the single-cue path. */
export async function tokenizeBatch(
  cfg: MecabConfig,
  texts: readonly string[],
  exec: MecabExec = execMecab
): Promise<Token[][]> {
  const results = new Array<Token[]>(texts.length)
  const batch: Array<{ text: string; index: number }> = []
  const fallback: Array<{ text: string; index: number }> = []
  texts.forEach((text, index) => {
    if (text !== '' && !/[\r\n]/.test(text)) batch.push({ text, index })
    else fallback.push({ text, index })
  })

  const batchPromise =
    batch.length === 0
      ? Promise.resolve()
      : exec(
          cfg.mecabPath,
          buildMecabArgs(cfg.dicdir),
          batch.map(({ text }) => text).join('\n')
        ).then((stdout) => {
          const sections: string[] = []
          let lines: string[] = []
          for (const line of stdout.split(/\r?\n/)) {
            if (line === 'EOS') {
              sections.push(lines.join('\n'))
              lines = []
            } else {
              lines.push(line)
            }
          }
          if (sections.length !== batch.length || lines.some(Boolean))
            throw new Error('MeCab batch output did not match its input cue count')
          batch.forEach(({ index, text }, i) => {
            results[index] = parseMecab(cfg.flavor, sections[i], text)
          })
        })

  await batchPromise
  for (let i = 0; i < fallback.length; i += 2) {
    await Promise.all(
      fallback.slice(i, i + 2).map(async ({ text, index }) => {
        results[index] = await tokenize(cfg, text, exec)
      })
    )
  }
  return results
}
