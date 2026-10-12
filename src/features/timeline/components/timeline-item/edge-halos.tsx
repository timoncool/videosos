import { memo } from 'react'
import { CONSTRAINED_COLORS, FREE_COLORS, type ActiveEdgeState } from './trim-constants'

function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-percent-per-frame, 0%))`
}

interface EdgeHalosProps {
  activeEdges: ActiveEdgeState | null
  visualLeftFrame: number
  visualWidthFrames: number
}

export const EdgeHalos = memo(function EdgeHalos({
  activeEdges,
  visualLeftFrame,
  visualWidthFrames,
}: EdgeHalosProps) {
  if (!activeEdges) return null

  return (
    <div
      className="absolute inset-y-0 pointer-events-none"
      style={{
        left: getFramePositionStyle(visualLeftFrame),
        width: getFramePositionStyle(visualWidthFrames),
        zIndex: 2,
      }}
    >
      {activeEdges.start &&
        (() => {
          const constrained =
            activeEdges.constrainedEdge === 'start' || activeEdges.constrainedEdge === 'both'
          const colors = constrained ? CONSTRAINED_COLORS : FREE_COLORS
          return (
            <>
              <div
                className="absolute inset-y-0 left-0"
                style={{ width: '2px', background: colors.edge, boxShadow: colors.glow }}
              />
              <div
                className="absolute inset-y-0"
                style={{
                  left: '2px',
                  width: '8px',
                  background: `linear-gradient(to right, ${colors.fade}, transparent)`,
                }}
              />
            </>
          )
        })()}
      {activeEdges.end &&
        (() => {
          const constrained =
            activeEdges.constrainedEdge === 'end' || activeEdges.constrainedEdge === 'both'
          const colors = constrained ? CONSTRAINED_COLORS : FREE_COLORS
          return (
            <>
              <div
                className="absolute inset-y-0 right-0"
                style={{ width: '2px', background: colors.edge, boxShadow: colors.glow }}
              />
              <div
                className="absolute inset-y-0"
                style={{
                  right: '2px',
                  width: '8px',
                  background: `linear-gradient(to left, ${colors.fade}, transparent)`,
                }}
              />
            </>
          )
        })()}
    </div>
  )
})
