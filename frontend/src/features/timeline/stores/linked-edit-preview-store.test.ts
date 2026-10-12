import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useLinkedEditPreviewStore } from './linked-edit-preview-store'

describe('useLinkedEditPreviewStore', () => {
  beforeEach(() => {
    useLinkedEditPreviewStore.setState({ updatesById: {} })
  })

  it('skips the store write when rebuilt updates carry identical values', () => {
    const store = useLinkedEditPreviewStore
    store.getState().setUpdates([{ id: 'a', from: 10, durationInFrames: 30 }])
    const first = store.getState().updatesById

    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    // Same values, fresh objects/array — the gesture-frame case.
    store.getState().setUpdates([{ id: 'a', from: 10, durationInFrames: 30 }])

    expect(store.getState().updatesById).toBe(first)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('writes when any previewed value changes', () => {
    const store = useLinkedEditPreviewStore
    store.getState().setUpdates([{ id: 'a', from: 10 }])

    store.getState().setUpdates([{ id: 'a', from: 11 }])

    expect(store.getState().updatesById.a?.from).toBe(11)
  })

  it('writes when the update set itself changes', () => {
    const store = useLinkedEditPreviewStore
    store.getState().setUpdates([{ id: 'a', from: 10 }, { id: 'b', from: 20 }])

    store.getState().setUpdates([{ id: 'a', from: 10 }])

    expect(Object.keys(store.getState().updatesById)).toEqual(['a'])
  })

  it('treats hidden flips between false and undefined as a change', () => {
    const store = useLinkedEditPreviewStore
    store.getState().setUpdates([{ id: 'a', hidden: false }])

    store.getState().setUpdates([{ id: 'a' }])

    expect(store.getState().updatesById.a?.hidden).toBeUndefined()
  })

  it('clear is a no-op while already empty', () => {
    const store = useLinkedEditPreviewStore
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.getState().clear()

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('clear empties a populated preview', () => {
    const store = useLinkedEditPreviewStore
    store.getState().setUpdates([{ id: 'a', from: 10 }])

    store.getState().clear()

    expect(store.getState().updatesById).toEqual({})
  })
})
