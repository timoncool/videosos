/**
 * Native SVG shape components to replace @legacy-video/shapes
 *
 * These components render SVG elements that match the Composition shapes API.
 */

import React from 'react'
import {
  makeRect,
  makeCircle,
  makeEllipse,
  makeTriangle,
  makeStar,
  makePolygon,
  makeHeart,
} from './shape-generators'
import { getTrimPathSvgProps, type TrimPathValues } from './trim-path'
import { getTaperStrokeSegments, hasActiveTaper, type TaperPathValues } from './taper-path'

interface BaseShapeProps extends TrimPathValues, TaperPathValues {
  fill?: string
  fillDefinition?: React.ReactNode
  stroke?: string
  strokeWidth?: number
  style?: React.CSSProperties
  className?: string
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterlimit?: number
}

export const ShapePath: React.FC<BaseShapeProps & { d: string }> = ({
  d,
  fill,
  stroke,
  strokeWidth,
  taperStartWidth,
  taperEndWidth,
  taperStartLength,
  taperEndLength,
  ...presentation
}) => {
  const taperValues = {
    taperStartWidth,
    taperEndWidth,
    taperStartLength,
    taperEndLength,
    trimPathStart: presentation.trimPathStart,
    trimPathEnd: presentation.trimPathEnd,
    trimPathOffset: presentation.trimPathOffset,
  }
  const tapered = !!stroke && !!strokeWidth && hasActiveTaper(taperValues)
  const segments = tapered ? getTaperStrokeSegments(taperValues) : []

  return (
    <>
      <path
        d={d}
        fill={fill}
        stroke={tapered ? undefined : stroke}
        strokeWidth={strokeWidth}
        {...getPathPresentationProps(presentation)}
      />
      {segments.map((segment, index) => (
        <path
          key={index}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth! * segment.widthScale}
          pathLength={100}
          strokeDasharray={`${segment.length} ${100 - segment.length}`}
          strokeDashoffset={-segment.offset}
          strokeLinecap="butt"
          strokeLinejoin={presentation.strokeLinejoin}
          strokeMiterlimit={presentation.strokeMiterlimit}
        />
      ))}
    </>
  )
}

function getPathPresentationProps(props: Partial<BaseShapeProps>) {
  return {
    ...getTrimPathSvgProps(props),
    strokeLinecap: props.strokeLinecap,
    strokeLinejoin: props.strokeLinejoin,
    strokeMiterlimit: props.strokeMiterlimit,
  }
}

/**
 * Rectangle shape component
 */
export const Rect: React.FC<
  BaseShapeProps & {
    width: number
    height: number
    cornerRadius?: number
  }
> = ({
  width,
  height,
  cornerRadius = 0,
  fill,
  fillDefinition,
  stroke,
  strokeWidth,
  style,
  className,
  ...trim
}) => {
  const { path } = makeRect({ width, height, cornerRadius })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}

/**
 * Circle shape component
 */
export const Circle: React.FC<
  BaseShapeProps & {
    radius: number
  }
> = ({ radius, fill, fillDefinition, stroke, strokeWidth, style, className, ...trim }) => {
  const { path, width, height } = makeCircle({ radius })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}

/**
 * Ellipse shape component
 */
export const Ellipse: React.FC<
  BaseShapeProps & {
    rx: number
    ry: number
  }
> = ({ rx, ry, fill, fillDefinition, stroke, strokeWidth, style, className, ...trim }) => {
  const { path, width, height } = makeEllipse({ rx, ry })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}

/**
 * Triangle shape component
 */
export const Triangle: React.FC<
  BaseShapeProps & {
    length: number
    direction?: 'up' | 'down' | 'left' | 'right'
    cornerRadius?: number
  }
> = ({
  length,
  direction = 'up',
  cornerRadius = 0,
  fill,
  fillDefinition,
  stroke,
  strokeWidth,
  style,
  className,
  ...trim
}) => {
  const { path, width, height } = makeTriangle({ length, direction, cornerRadius })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}

/**
 * Star shape component
 */
export const Star: React.FC<
  BaseShapeProps & {
    points: number
    outerRadius: number
    innerRadius: number
    cornerRadius?: number
  }
> = ({
  points,
  outerRadius,
  innerRadius,
  cornerRadius = 0,
  fill,
  fillDefinition,
  stroke,
  strokeWidth,
  style,
  className,
  ...trim
}) => {
  const { path, width, height } = makeStar({ points, outerRadius, innerRadius, cornerRadius })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}

/**
 * Polygon shape component
 */
export const Polygon: React.FC<
  BaseShapeProps & {
    points: number
    radius: number
    cornerRadius?: number
  }
> = ({
  points,
  radius,
  cornerRadius = 0,
  fill,
  fillDefinition,
  stroke,
  strokeWidth,
  style,
  className,
  ...trim
}) => {
  const { path, width, height } = makePolygon({ points, radius, cornerRadius })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}

/**
 * Heart shape component
 */
export const Heart: React.FC<
  BaseShapeProps & {
    height: number
  }
> = ({ height, fill, fillDefinition, stroke, strokeWidth, style, className, ...trim }) => {
  const result = makeHeart({ height })

  return (
    <svg
      width={result.width}
      height={result.height}
      viewBox={`0 0 ${result.width} ${result.height}`}
      overflow="visible"
      style={style}
      className={className}
    >
      {fillDefinition}
      <ShapePath d={result.path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} {...trim} />
    </svg>
  )
}
