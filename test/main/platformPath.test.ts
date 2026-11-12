import { describe, it, expect } from 'vitest'
import { uniqueTempName } from '@src/main/platformPath'

describe('uniqueTempName', () => {
  it('gives each call a distinct random name with the prefix and extension', () => {
    const names = [uniqueTempName('kizuna-frame', 'png'), uniqueTempName('kizuna-frame', 'png')]
    for (const name of names) expect(name).toMatch(/^kizuna-frame-[0-9a-f]{12}\.png$/)
    expect(names[0]).not.toBe(names[1])
  })
})
