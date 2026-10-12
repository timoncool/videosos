import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
} from '@/features/editor/deps/timeline-store'
import { CompositionControlsAuthoringSection } from './composition-controls-authoring-section'

const SOURCE_TEXT: TextItem = {
  id: 'title',
  trackId: 'source-track',
  type: 'text',
  label: 'Headline',
  text: 'Original',
  color: '#ffffff',
  from: 0,
  durationInFrames: 30,
}

describe('CompositionControlsAuthoringSection', () => {
  beforeEach(() => {
    useCompositionNavigationStore.setState({ activeCompositionId: 'card' })
    useCompositionsStore.getState().setCompositions([
      {
        id: 'card',
        name: 'Card',
        editorKind: 'composite-2d',
        items: [SOURCE_TEXT],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
      },
    ])
    useItemsStore.getState().setItems([SOURCE_TEXT])
  })

  it('presents one purposeful expose action instead of an empty-state row', () => {
    render(<CompositionControlsAuthoringSection />)

    expect(screen.getByText('Published controls (0)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expose property' })).toBeEnabled()
    expect(screen.queryByText('No controls exposed yet.')).not.toBeInTheDocument()
  })

  it('can stay collapsed in the Motion composition inspector', () => {
    render(<CompositionControlsAuthoringSection defaultOpen={false} />)

    expect(screen.getByRole('button', { name: 'Published controls (0)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('button', { name: 'Expose property' })).not.toBeInTheDocument()
  })
})
