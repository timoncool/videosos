import { describe, expect, it, vi } from 'vite-plus/test'
import {
  MARQUEE_CANDIDATE_ATTRIBUTE,
  updateMarqueeCandidateElements,
} from './marquee-candidate-preview'

describe('marquee candidate preview', () => {
  it('updates only changed candidate outlines and clears them at gesture end', () => {
    const text = document.createElement('div')
    const polygon = document.createElement('div')
    const textSetAttribute = vi.spyOn(text, 'setAttribute')
    const elements = new Map([
      ['text', text],
      ['polygon', polygon],
    ])

    let previewIds = updateMarqueeCandidateElements(elements, new Set(), ['text'])
    expect(text).toHaveAttribute(MARQUEE_CANDIDATE_ATTRIBUTE, 'true')
    expect(polygon).not.toHaveAttribute(MARQUEE_CANDIDATE_ATTRIBUTE)

    previewIds = updateMarqueeCandidateElements(elements, previewIds, ['text', 'polygon'])
    expect(textSetAttribute).toHaveBeenCalledTimes(1)
    expect(polygon).toHaveAttribute(MARQUEE_CANDIDATE_ATTRIBUTE, 'true')

    previewIds = updateMarqueeCandidateElements(elements, previewIds, ['polygon'])
    expect(text).not.toHaveAttribute(MARQUEE_CANDIDATE_ATTRIBUTE)
    expect(polygon).toHaveAttribute(MARQUEE_CANDIDATE_ATTRIBUTE, 'true')

    updateMarqueeCandidateElements(elements, previewIds, [])
    expect(polygon).not.toHaveAttribute(MARQUEE_CANDIDATE_ATTRIBUTE)
  })
})
