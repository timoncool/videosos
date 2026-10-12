import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { ShuttleIndicator } from './shuttle-indicator'

describe('ShuttleIndicator', () => {
  it('stays hidden outside transient shuttle playback', () => {
    const { container } = render(<ShuttleIndicator active={false} playbackRate={1} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows forward shuttle direction, key, and speed', () => {
    render(<ShuttleIndicator active playbackRate={2} />)

    expect(screen.getByRole('status', { name: 'Forward shuttle 2x' })).toHaveTextContent('L▶2×')
  })

  it('shows reverse shuttle direction, key, and speed', () => {
    render(<ShuttleIndicator active playbackRate={-4} />)

    expect(screen.getByRole('status', { name: 'Reverse shuttle 4x' })).toHaveTextContent('J◀4×')
  })
})
