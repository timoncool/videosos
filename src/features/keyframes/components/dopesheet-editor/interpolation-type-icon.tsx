import type { EasingType } from '@/types/keyframe'

export function InterpolationTypeIcon({ type }: { type: EasingType }) {
  const iconProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
  }

  const curveProps = {
    stroke: 'currentColor',
    strokeWidth: 0.88,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  const guideProps = {
    ...curveProps,
    strokeWidth: 0.66,
    opacity: 0.5,
  }

  const start = { x: 2.1, y: 11.9 }
  const end = { x: 13.9, y: 4.1 }

  const toScreenPoint = (x: number, y: number) => ({
    x: start.x + (end.x - start.x) * x,
    y: start.y - (start.y - end.y) * y,
  })

  const formatPoint = (point: { x: number; y: number }) =>
    `${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  const getDistance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)

  const renderControlHandle = (
    anchor: { x: number; y: number },
    control: { x: number; y: number },
    key: string,
  ) => {
    if (getDistance(anchor, control) < 0.9) {
      return null
    }

    return (
      <g key={key}>
        <path d={`M${formatPoint(anchor)}L${formatPoint(control)}`} {...guideProps} />
        <circle
          cx={control.x}
          cy={control.y}
          r="0.56"
          fill="currentColor"
          stroke="none"
          opacity="0.68"
        />
      </g>
    )
  }

  const renderBezier = (x1: number, y1: number, x2: number, y2: number) => {
    const controlOne = toScreenPoint(x1, y1)
    const controlTwo = toScreenPoint(x2, y2)

    return (
      <>
        {renderControlHandle(start, controlOne, 'control-one')}
        {renderControlHandle(end, controlTwo, 'control-two')}
        <path
          d={`M${formatPoint(start)}C${formatPoint(controlOne)} ${formatPoint(controlTwo)} ${formatPoint(end)}`}
          {...curveProps}
        />
      </>
    )
  }

  const iconContent = (() => {
    if (type === 'linear') {
      return <path d={`M${formatPoint(start)}L${formatPoint(end)}`} {...curveProps} />
    }

    if (type === 'hold') {
      const step = toScreenPoint(1, 0)
      return (
        <path
          d={`M${formatPoint(start)}L${formatPoint(step)}L${formatPoint(end)}`}
          {...curveProps}
        />
      )
    }

    if (type === 'ease-in') {
      return renderBezier(0.42, 0, 1, 1)
    }

    if (type === 'ease-out') {
      return renderBezier(0, 0, 0.58, 1)
    }

    if (type === 'ease-in-out') {
      return renderBezier(0.42, 0, 0.58, 1)
    }

    if (type === 'cubic-bezier') {
      return renderBezier(0.2, 0.1, 0.74, 0.88)
    }

    const springOne = toScreenPoint(0.24, 0.02)
    const springTwo = toScreenPoint(0.36, 0.58)
    const springMid = toScreenPoint(0.52, 0.58)
    const springThree = toScreenPoint(0.68, 0.58)
    const springFour = toScreenPoint(0.8, 1.08)
    const springSettle = toScreenPoint(0.9, 0.98)
    const springFive = toScreenPoint(0.98, 1)

    return (
      <>
        {renderControlHandle(start, springOne, 'spring-control-one')}
        {renderControlHandle(end, springFive, 'spring-control-two')}
        <path
          d={[
            `M${formatPoint(start)}`,
            `C${formatPoint(springOne)} ${formatPoint(springTwo)} ${formatPoint(springMid)}`,
            `C${formatPoint(springThree)} ${formatPoint(springFour)} ${formatPoint(springSettle)}`,
            `C${formatPoint(springSettle)} ${formatPoint(springFive)} ${formatPoint(end)}`,
          ].join(' ')}
          {...curveProps}
        />
      </>
    )
  })()

  return (
    <svg aria-hidden="true" {...iconProps}>
      {iconContent}
      <circle cx={start.x} cy={start.y} r="0.74" fill="currentColor" stroke="none" />
      <circle cx={end.x} cy={end.y} r="0.74" fill="currentColor" stroke="none" />
    </svg>
  )
}
