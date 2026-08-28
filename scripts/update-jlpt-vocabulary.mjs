#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createVocabularySnapshot,
  JLPT_LEVELS,
  serializeVocabularySnapshot,
  VOCABULARY_SOURCE
} from './jlptVocabulary.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The only URLs this maintenance command is allowed to download. */
export const INPUTS = Object.freeze(
  JLPT_LEVELS.map((level) => ({
    level,
    path: `data/json/vocab/${level.toLowerCase()}.json`,
    url: `https://raw.githubusercontent.com/evanclan/OpenJLPT/${VOCABULARY_SOURCE.commit}/data/json/vocab/${level.toLowerCase()}.json`,
    sha256: {
      N5: '3e606fc15fd5d177fa7c3928c17f28b0d34ac84ec6bdbfe0947b339d9d815a6d',
      N4: '978b9813afaac181fe1308eb1ad7d4cb4ad4ffc9178fa88fc7fb2832de5dbb62',
      N3: 'd8ce3998ebb254567436ef3d34c96f6aac83c2c88dbfb85af5e5935bd1bd21ed',
      N2: '12094a0f89a8f4a77f7d230aa280900c60c149f60dba2a810589f60407d3190f',
      N1: 'e9662df1dba34c2f566a128f203c8a78296c1c2c1a337b8ef036ca516ea8430e'
    }[level]
  }))
)

export const OUTPUT_PATH = join('src', 'main', 'services', 'jlpt', 'data', 'vocabulary.json')

/** @param {ArrayBuffer} bytes @returns {string} */
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')

/**
 * Download, validate, and atomically write the pinned snapshot.
 *
 * @param {{ fetchImpl?: typeof fetch, outputPath?: string, root?: string }} [options]
 * @returns {Promise<{ outputPath: string, inputRecordCount: number, entryCount: number }>}
 */
export async function updateVocabulary({ fetchImpl = fetch, outputPath, root = repoRoot } = {}) {
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

  const snapshot = createVocabularySnapshot(files)
  const target = outputPath ?? join(root, OUTPUT_PATH)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, serializeVocabularySnapshot(snapshot), {
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
  updateVocabulary()
    .then(({ inputRecordCount, entryCount, outputPath }) => {
      console.log(`Wrote ${entryCount} entries from ${inputRecordCount} records to ${outputPath}`)
    })
    .catch((error) => {
      console.error(`\n${error.message}\n`)
      process.exitCode = 1
    })
}
