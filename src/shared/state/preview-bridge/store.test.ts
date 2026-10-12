import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { usePreviewBridgeStore } from './store'

describe('preview-bridge-store', () => {
  beforeEach(() => {
    usePreviewBridgeStore.setState({
      displayedFrame: null,
      captureFrame: null,
      captureFrameImageData: null,
      captureCanvasSource: null,
      postEditWarmRequest: null,
    })
  })

  it('normalizes displayedFrame updates', () => {
    const store = usePreviewBridgeStore.getState()

    store.setDisplayedFrame(24.6)
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(25)

    store.setDisplayedFrame(-10)
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(0)

    store.setDisplayedFrame(Number.NaN)
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(0)

    store.setDisplayedFrame(null)
    expect(usePreviewBridgeStore.getState().displayedFrame).toBeNull()
  })

  it('avoids store churn when displayedFrame is unchanged', () => {
    usePreviewBridgeStore.getState().setDisplayedFrame(42)
    const stateA = usePreviewBridgeStore.getState()

    usePreviewBridgeStore.getState().setDisplayedFrame(42)
    const stateB = usePreviewBridgeStore.getState()

    expect(stateA).toBe(stateB)
  })

  it('stores post-edit warm requests with normalized frames and incrementing tokens', () => {
    const store = usePreviewBridgeStore.getState()

    store.requestPostEditWarm(48.6, ['clip-1'], [48.6, 47.8, 48.6, -2])
    expect(usePreviewBridgeStore.getState().postEditWarmRequest).toEqual({
      frame: 49,
      frames: [49, 48, 0],
      itemIds: ['clip-1'],
      token: 1,
    })

    store.requestPostEditWarm(-2, ['clip-2', 'clip-3'])
    expect(usePreviewBridgeStore.getState().postEditWarmRequest).toEqual({
      frame: 0,
      frames: [0],
      itemIds: ['clip-2', 'clip-3'],
      token: 2,
    })
  })
})
