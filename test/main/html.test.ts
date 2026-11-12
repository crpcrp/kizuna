import { describe, it, expect } from 'vitest'
import { stripTags } from '@src/main/html'

describe('stripTags', () => {
  it('repeats tag removal until nested tags are gone', () => {
    expect(stripTags('<<script>alert(1)</script>')).toBe('alert(1)')
  })

  it('substitutes the replacement for each tag and leaves entities alone', () => {
    expect(stripTags('<p>a</p><p>&lt;b&gt;</p>', ' ')).toBe(' a  &lt;b&gt; ')
  })
})
