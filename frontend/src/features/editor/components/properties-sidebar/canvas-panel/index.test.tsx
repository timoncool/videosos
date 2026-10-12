import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineCommandStore,
} from '@/features/editor/deps/timeline-store'
import { setTimelineState } from '@/features/editor/deps/timeline-test-helpers-contract'
import { CanvasPanel } from './index'

describe('CanvasPanel in a Motion composition', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: {
        id: 'project-1',
        name: 'Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 0,
        metadata: {
          width: 1280,
          height: 720,
          fps: 30,
          backgroundColor: '#000000',
        },
      },
    })
    useCompositionsStore.getState().setCompositions([
      {
        id: 'motion-card',
        name: 'Motion Card',
        editorKind: 'composite-2d',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 24,
        width: 1080,
        height: 1920,
        durationInFrames: 300,
        backgroundColor: '#123456',
      },
    ])
    useCompositionNavigationStore.setState({ activeCompositionId: 'motion-card' })
    setTimelineState({
      fps: 24,
      items: [],
      markers: [],
    })
    useTimelineCommandStore.getState().clearHistory()
  })

  it('shows composition-owned settings and de-emphasizes advanced empty sections', () => {
    render(<CanvasPanel />)

    expect(screen.getByRole('button', { name: 'Composition' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByDisplayValue('1080')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1920')).toBeInTheDocument()
    expect(screen.getByDisplayValue('300')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '#123456' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Published controls (0)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('button', { name: 'Markers' })).not.toBeInTheDocument()
  })

  it('edits the composition without mutating root project metadata', () => {
    render(<CanvasPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Swap' }))

    expect(useCompositionsStore.getState().getComposition('motion-card')).toMatchObject({
      width: 1920,
      height: 1080,
    })
    expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
      width: 1280,
      height: 720,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Match Project' }))
    expect(useCompositionsStore.getState().getComposition('motion-card')).toMatchObject({
      width: 1280,
      height: 720,
    })
  })
})
