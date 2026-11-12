#!/usr/bin/env node
// Usage: node scripts/update-jlpt.mjs <kanji|vocabulary>

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createKanjiSnapshot } from './jlptKanji.mjs'
import {
  createVocabularySnapshot,
  JLPT_LEVELS,
  serializeSnapshot,
  VOCABULARY_SOURCE
} from './jlptVocabulary.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const KINDS = {
  kanji: {
    upstreamDir: 'kanji',
    output: 'kanji.json',
    createSnapshot: createKanjiSnapshot,
    sha256: {
      N5: 'bea3728c11ea2a198b28aca1860acf37eae00a33189f7cab366027eca80cccca',
      N4: '5d26112e42a99d3d97ba614f3ef7f71605de237a95a6af4f96e5d444c8ac47eb',
      N3: '99e632d1d8972dadc2bd2d4c2dee37366b4d32d0173f17b1aa182351adc91273',
      N2: '62cc69b2259811e68a53576ac1efc43fc658af5536232d9985a733251292178b',
      N1: '75bbb2e45d3cfb7e8a1de42cd36c4a70af0ebf31ec4589503434ac3dd7522db6'
    }
  },
  vocabulary: {
    upstreamDir: 'vocab',
    output: 'vocabulary.json',
    createSnapshot: createVocabularySnapshot,
    sha256: {
      N5: '3e606fc15fd5d177fa7c3928c17f28b0d34ac84ec6bdbfe0947b339d9d815a6d',
      N4: '978b9813afaac181fe1308eb1ad7d4cb4ad4ffc9178fa88fc7fb2832de5dbb62',
      N3: 'd8ce3998ebb254567436ef3d34c96f6aac83c2c88dbfb85af5e5935bd1bd21ed',
      N2: '12094a0f89a8f4a77f7d230aa280900c60c149f60dba2a810589f60407d3190f',
      N1: 'e9662df1dba34c2f566a128f203c8a78296c1c2c1a337b8ef036ca516ea8430e'
    }
  }
}

/**
 * The only URLs this maintenance command is allowed to download.
 *
 * @param {keyof typeof KINDS} kind
 */
export function inputs(kind) {
  const { upstreamDir, sha256 } = KINDS[kind]
  return JLPT_LEVELS.map((level) => {
    const path = `data/json/${upstreamDir}/${level.toLowerCase()}.json`
    return {
      level,
      path,
      url: `https://raw.githubusercontent.com/evanclan/OpenJLPT/${VOCABULARY_SOURCE.commit}/${path}`,
      sha256: sha256[level]
    }
  })
}

/** @param {ArrayBuffer} bytes @returns {string} */
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')

/**
 * Download, validate, and atomically write the pinned snapshot.
 *
 * @param {keyof typeof KINDS} kind
 * @param {{ fetchImpl?: typeof fetch, outputPath?: string, root?: string }} [options]
 * @returns {Promise<{ outputPath: string, inputRecordCount: number, entryCount: number }>}
 */
export async function updateJlpt(kind, { fetchImpl = fetch, outputPath, root = repoRoot } = {}) {
  const files = []
  for (const input of inputs(kind)) {
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

  const snapshot = KINDS[kind].createSnapshot(files)
  const target =
    outputPath ?? join(root, 'src', 'main', 'services', 'jlpt', 'data', KINDS[kind].output)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, serializeSnapshot(snapshot), { encoding: 'utf8', flag: 'wx' })
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
  const kind = process.argv[2]
  if (!Object.hasOwn(KINDS, kind)) {
    console.error('Usage: node scripts/update-jlpt.mjs <kanji|vocabulary>')
    process.exit(1)
  }
  updateJlpt(kind)
    .then(({ inputRecordCount, entryCount, outputPath }) => {
      console.log(`Wrote ${entryCount} entries from ${inputRecordCount} records to ${outputPath}`)
    })
    .catch((error) => {
      console.error(`\n${error.message}\n`)
      process.exitCode = 1
    })
}
