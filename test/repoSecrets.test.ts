import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'

describe('.ignore secret protection', () => {
  it('does not un-ignore environment files or common secret files', () => {
    const ignore = readFileSync(join(REPO_ROOT, '.ignore'), 'utf-8')
    const negations = ignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('!'))
      .map((line) => line.slice(1))

    expect(negations).not.toContain('.env')
    expect(negations).not.toContain('.env.*')
    expect(negations).not.toContain('credentials.json')
    expect(negations).not.toContain('secrets.json')
    expect(negations).not.toContain('*.pem')
    expect(negations).not.toContain('*.key')
    expect(negations).not.toContain('*.p12')
    expect(negations).not.toContain('*.pfx')
  })
})
