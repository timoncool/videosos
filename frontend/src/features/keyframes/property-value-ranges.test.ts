import { describe, expect, it } from 'vite-plus/test'
import { PROPERTY_VALUE_RANGES } from './property-value-ranges'

describe('PROPERTY_VALUE_RANGES', () => {
  it('covers the full text preset scale supported by the text inspector', () => {
    expect(PROPERTY_VALUE_RANGES.textStyleScale).toMatchObject({ min: 0.5, max: 6 })
  })

  it('covers scaled text preset shadows', () => {
    expect(PROPERTY_VALUE_RANGES.textShadowBlur).toMatchObject({ min: 0, max: 160 })
  })

  it('uses normalized graph ranges for path positions and bezier handles', () => {
    expect(PROPERTY_VALUE_RANGES['pathVertex:0:positionX']).toMatchObject({
      min: 0,
      max: 1,
      decimals: 3,
    })
    expect(PROPERTY_VALUE_RANGES['pathVertex:0:outY']).toMatchObject({
      min: -2,
      max: 2,
      decimals: 3,
    })
  })
})
