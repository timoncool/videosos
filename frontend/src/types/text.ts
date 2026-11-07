export type TextFontWeight = 'normal' | 'medium' | 'semibold' | 'bold'
export type TextFontStyle = 'normal' | 'italic'
export type TextHorizontalAlign = 'left' | 'center' | 'right'
export type TextVerticalAlign = 'top' | 'middle' | 'bottom'

export type TextInlineStyleFields = {
  fontSize?: number
  fontFamily?: string
  fontWeight?: TextFontWeight
  fontStyle?: TextFontStyle
  underline?: boolean
  color?: string
  letterSpacing?: number
}

export type TextSpan = TextInlineStyleFields & {
  text: string
}

export type TextSingleLayoutDraft = TextSpan

export type TextLayoutDrafts = {
  single?: TextSingleLayoutDraft
  twoSpans?: TextSpan[]
  threeSpans?: TextSpan[]
}

export type TextShadow = {
  offsetX: number
  offsetY: number
  blur: number
  color: string
}

export type TextStroke = {
  width: number
  color: string
}

/** How a caption with word timings shows: the whole line, word by word as spoken, or the whole line with the spoken word lit. */
export type CaptionReveal = 'whole' | 'words' | 'karaoke'

export type TextVisualStyleFields = {
  captionReveal?: CaptionReveal
  /** The colour the spoken word is lit with in karaoke. */
  captionHighlight?: string
  backgroundColor?: string
  backgroundRadius?: number
  textAlign?: TextHorizontalAlign
  verticalAlign?: TextVerticalAlign
  lineHeight?: number
  textPadding?: number
  textShadow?: TextShadow
  stroke?: TextStroke
}

export type TextStyleFields = TextInlineStyleFields & TextVisualStyleFields
