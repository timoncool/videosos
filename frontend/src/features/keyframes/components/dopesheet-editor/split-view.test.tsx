import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'

/**
 * Characterizes the Animate-workspace `split` presentation (U4) against the
 * exclusive `dopesheet` / `graph` modes it must leave untouched:
 *  - `dopesheet`: sheet playhead overlay present, no graph pane.
 *  - `graph`: graph pane present, sheet overlay deferred to the graph's own
 *    playhead (no `dopesheet-playhead-line`).
 *  - `split`: BOTH the sheet overlay and the graph pane render at once.
 */
describe('DopesheetEditor split view', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  const baseProps = {
    itemId: 'item-1',
    keyframesByProperty: { x: [] },
    currentFrame: 0,
    width: 640,
    height: 240,
  }

  it('dopesheet mode renders the sheet playhead overlay and no graph pane', () => {
    render(<DopesheetEditor {...baseProps} visualizationMode="dopesheet" />)
    expect(screen.getByTestId('dopesheet-playhead-clip')).toBeInTheDocument()
    expect(screen.queryByTestId('dopesheet-graph-pane')).not.toBeInTheDocument()
  })

  it('graph mode renders the graph pane and defers the playhead to the graph', () => {
    render(<DopesheetEditor {...baseProps} visualizationMode="graph" />)
    expect(screen.getByTestId('dopesheet-graph-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('dopesheet-playhead-clip')).not.toBeInTheDocument()
  })

  it('split mode renders the sheet overlay and the graph pane simultaneously', () => {
    render(<DopesheetEditor {...baseProps} visualizationMode="split" />)
    // Sheet pane (its aligned playhead overlay) and the curve/graph pane both present.
    expect(screen.getByTestId('dopesheet-playhead-clip')).toBeInTheDocument()
    expect(screen.getByTestId('dopesheet-graph-pane')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sheet' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Graph' })).toBeInTheDocument()
    // The shared ruler is rendered once.
    expect(screen.getAllByTestId('dopesheet-ruler')).toHaveLength(1)
  })
})
