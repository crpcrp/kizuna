// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SeekPreview from '@src/renderer/src/components/SeekPreview'
import { HIDDEN_PREVIEW } from '@src/renderer/src/state/seekPreview'

afterEach(cleanup)

describe('SeekPreview', () => {
  it('renders nothing when the preview is hidden', () => {
    const { container } = render(<SeekPreview state={HIDDEN_PREVIEW} />)
    expect(container.querySelector('#seek-preview')).toBeNull()
  })

  it('shows a placeholder (no image) and the timestamp while the frame loads', () => {
    const { container } = render(
      <SeekPreview
        state={{
          visible: true,
          dataUrl: null,
          timeSec: 65,
          positionRatio: 0.25,
          containerWidth: 400
        }}
      />
    )
    const box = container.querySelector('#seek-preview') as HTMLElement
    expect(box).not.toBeNull()
    expect(box.style.left).toBe('19px')
    expect(box.style.width).toBe('162px')
    expect(box.style.transform).toBe('')
    expect(container.querySelector('.seek-preview-image')).toBeNull()
    expect(container.querySelector('.seek-preview-placeholder')).not.toBeNull()
    expect(container.querySelector('.seek-preview-time')?.textContent).toBe('1:05')
  })

  it('shrinks to a narrow container without horizontal overflow', () => {
    const { container } = render(
      <SeekPreview
        state={{
          visible: true,
          dataUrl: null,
          timeSec: 5,
          positionRatio: 1,
          containerWidth: 100
        }}
      />
    )
    const box = container.querySelector('#seek-preview') as HTMLElement
    expect(box.style.left).toBe('0px')
    expect(box.style.width).toBe('100px')
  })

  it('renders the frame image once a data URL is present', () => {
    const dataUrl = 'data:image/jpeg;base64,AAA'
    const { container } = render(
      <SeekPreview
        state={{ visible: true, dataUrl, timeSec: 0, positionRatio: 0.5, containerWidth: 400 }}
      />
    )
    const img = container.querySelector('.seek-preview-image') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe(dataUrl)
    expect(container.querySelector('.seek-preview-placeholder')).toBeNull()
  })
})
