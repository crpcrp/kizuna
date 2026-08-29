#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createKanjiSnapshot, KANJI_SOURCE, serializeKanjiSnapshot } from './jlptKanji.mjs'
import { JLPT_LEVELS } from './jlptVocabulary.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The only URLs this maintenance command is allowed to download. */
export const INPUTS = Object.freeze(
  JLPT_LEVELS.map((level) => ({
    level,
    path: `data/json/kanji/${level.toLowerCase()}.json`,
    url: `https://raw.githubusercontent.com/evanclan/OpenJLPT/${KANJI_SOURCE.commit}/data/json/kanji/${level.toLowerCase()}.json`,
    sha256: {
      N5: 'bea3728c11ea2a198b28aca1860acf37eae00a33189f7cab366027eca80cccca',
      N4: '5d26112e42a99d3d97ba614f3ef7f71605de237a95a6af4f96e5d444c8ac47eb',
      N3: '99e632d1d8972dadc2bd2d4c2dee37366b4d32d0173f17b1aa182351adc91273',
      N2: '62cc69b2259811e68a53576ac1efc43fc658af5536232d9985a733251292178b',
      N1: '75bbb2e45d3cfb7e8a1de42cd36c4a70af0ebf31ec4589503434ac3dd7522db6'
    }[level]
  }))
)

export const OUTPUT_PATH = join('src', 'main', 'services', 'jlpt', 'data', 'kanji.json')

/** @param {ArrayBuffer} bytes @returns {string} */
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')

/**
 * Download, validate, and atomically write the pinned snapshot.
 *
 * @param {{ fetchImpl?: typeof fetch, outputPath?: string, root?: string }} [options]
 * @returns {Promise<{ outputPath: string, inputRecordCount: number, entryCount: number }>}
 */
export async function updateKanji({ fetchImpl = fetch, outputPath, root = repoRoot } = {}) {
  const files = []
  for (const input of INPUTS) {
    const response = await fetchImpl(input.url)
    if (!response.ok) {
      throw new Error(`OpenJLPT download failed for ${input.path}: HTTP ${response.status}`)
    }
    const bytes = await response.arrayBuffer()
    const actualHash = sha256(bytes)
    if (actualHash !== input.sha256) {
      throw new Error(
        `OpenJLPT hash mismatch for ${input.path}: expected ${input.sha256}, got ${actualHash}`
      )
    }
    files.push({
      level: input.level,
      contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      source: input.path
    })
  }

  const snapshot = createKanjiSnapshot(files)
  const target = outputPath ?? join(root, OUTPUT_PATH)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, serializeKanjiSnapshot(snapshot), {
      encoding: 'utf8',
      flag: 'wx'
    })
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return {
    outputPath: target,
    inputRecordCount: snapshot.inputRecordCount,
    entryCount: snapshot.entries.length
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateKanji()
    .then(({ inputRecordCount, entryCount, outputPath }) => {
      console.log(`Wrote ${entryCount} entries from ${inputRecordCount} records to ${outputPath}`)
    })
    .catch((error) => {
      console.error(`\n${error.message}\n`)
      process.exitCode = 1
    })
}
