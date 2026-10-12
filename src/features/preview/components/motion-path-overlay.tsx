import type { MotionPathScreenPoint } from '../utils/motion-path'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface MotionPathOverlayPath {
  itemId: string
  points: MotionPathScreenPoint[]
}

function buildPathD(points: MotionPathScreenPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.screenX} ${point.screenY}`)
    .join(' ')
}

export function MotionPathOverlay({
  paths,
  width,
  height,
  activeFrame,
  onKeyframePointerDown,
  onTangentPointerDown,
  onCreateSpatialTangents,
}: {
  paths: MotionPathOverlayPath[]
  width: number
  height: number
  activeFrame?: number
  onKeyframePointerDown?: (
    itemId: string,
    point: MotionPathScreenPoint,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  onTangentPointerDown?: (
    itemId: string,
    point: MotionPathScreenPoint,
    handle: 'in' | 'out',
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  onCreateSpatialTangents?: (itemId: string, point: MotionPathScreenPoint) => void
}) {
  if (paths.length === 0) return null

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[4]"
      data-testid="motion-path-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {paths.map((path) => (
        <g key={path.itemId}>
          <path
            d={buildPathD(path.points)}
            fill="none"
            stroke="rgba(15, 23, 42, 0.65)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildPathD(path.points)}
            fill="none"
            stroke="rgba(56, 189, 248, 0.88)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {path.points
            .filter(
              (point) =>
                point.frame === activeFrame &&
                point.keyframeId &&
                point.inHandle &&
                point.outHandle,
            )
            .map((point) => (
              <g key={`${path.itemId}:${point.keyframeId}:handles`}>
                <path
                  d={`M ${point.inHandle!.screenX} ${point.inHandle!.screenY} L ${point.screenX} ${point.screenY} L ${point.outHandle!.screenX} ${point.outHandle!.screenY}`}
                  fill="none"
                  stroke="rgba(250, 204, 21, 0.8)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {(['in', 'out'] as const).map((handle) => {
                  const position = handle === 'in' ? point.inHandle! : point.outHandle!
                  return (
                    <circle
                      key={handle}
                      cx={position.screenX}
                      cy={position.screenY}
                      r={4}
                      className="pointer-events-auto cursor-crosshair"
                      data-motion-path-handle={handle}
                      fill="rgba(15, 23, 42, 0.95)"
                      stroke="rgba(250, 204, 21, 0.95)"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        onTangentPointerDown?.(path.itemId, point, handle, event)
                      }}
                    />
                  )
                })}
              </g>
            ))}
          {path.points
            .filter((point) => point.isKeyframe)
            .map((point) => (
              <circle
                key={`${path.itemId}:${point.frame}`}
                cx={point.screenX}
                cy={point.screenY}
                r={3.5}
                fill="rgba(250, 204, 21, 0.95)"
                stroke="rgba(15, 23, 42, 0.85)"
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
                className={point.keyframeId ? 'pointer-events-auto cursor-move' : undefined}
                data-motion-path-keyframe-id={point.keyframeId}
                onPointerDown={(event) => {
                  if (!point.keyframeId) return
                  event.stopPropagation()
                  onKeyframePointerDown?.(path.itemId, point, event)
                }}
                onDoubleClick={(event) => {
                  if (!point.keyframeId) return
                  event.stopPropagation()
                  onCreateSpatialTangents?.(path.itemId, point)
                }}
              />
            ))}
        </g>
      ))}
    </svg>
  )
}
