import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { load } from 'js-yaml'
import { readFile } from 'node:fs/promises'

function fail(message) {
  throw new Error(`Invalid updater metadata: ${message}`)
}

async function sha512(file) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

const [metadataPath, ...expectedNames] = process.argv.slice(2)
if (!metadataPath || expectedNames.length === 0) {
  fail('usage: validate-update-metadata.mjs <metadata.yml> <payload> [...]')
}

const expectedMetadataName = expectedNames.some((name) => name.endsWith('.exe'))
  ? 'latest.yml'
  : 'latest-linux.yml'
if (basename(metadataPath) !== expectedMetadataName) {
  fail(`expected ${expectedMetadataName}, found ${basename(metadataPath)}`)
}

const metadata = load(await readFile(metadataPath, 'utf8'))
if (!metadata || typeof metadata !== 'object' || !Array.isArray(metadata.files)) {
  fail('files must be an array')
}

const expected = [...expectedNames].sort()
const actual = metadata.files.map((entry) => entry?.url).sort()
if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
  fail(`expected payloads ${expected.join(', ')}, found ${actual.join(', ')}`)
}

const seen = new Set()
for (const entry of metadata.files) {
  const name = entry?.url
  if (
    typeof name !== 'string' ||
    name !== basename(name) ||
    isAbsolute(name) ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    fail(`unsafe payload path: ${String(name)}`)
  }
  if (seen.has(name)) fail(`duplicate payload: ${name}`)
  seen.add(name)

  const payload = join(dirname(metadataPath), name)
  if (!existsSync(payload)) fail(`missing payload: ${name}`)
  if (entry.size !== statSync(payload).size) fail(`size does not match ${name}`)
  if (entry.sha512 !== (await sha512(payload))) fail(`SHA-512 does not match ${name}`)
}

const primary = metadata.files.find((entry) => entry.url === metadata.path)
if (!primary || metadata.sha512 !== primary.sha512) {
  fail('legacy path and SHA-512 do not match a payload')
}

console.log(`Validated ${basename(metadataPath)}: ${expected.join(', ')}`)
