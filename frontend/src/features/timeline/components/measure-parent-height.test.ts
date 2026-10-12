import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { observeParentElementHeight } from './measure-parent-height'

describe('observeParentElementHeight', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads layout once and ignores width-only resize notifications', () => {
    let callback: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(nextCallback: ResizeObserverCallback) {
          callback = nextCallback
        }
        observe = observe
        disconnect = disconnect
      },
    )

    const parent = document.createElement('div')
    const container = document.createElement('div')
    parent.append(container)
    const clientHeight = vi.spyOn(parent, 'clientHeight', 'get').mockReturnValue(48)
    const setHeight = vi.fn()

    const cleanup = observeParentElementHeight(container, setHeight)
    expect(clientHeight).toHaveBeenCalledOnce()
    expect(setHeight).toHaveBeenCalledWith(48)
    expect(observe).toHaveBeenCalledWith(parent)

    const entry = (height: number) =>
      ({ target: parent, contentRect: { height } }) as unknown as ResizeObserverEntry
    callback!([entry(48)], {} as ResizeObserver)
    expect(clientHeight).toHaveBeenCalledOnce()
    expect(setHeight).toHaveBeenCalledOnce()

    callback!([entry(56)], {} as ResizeObserver)
    expect(setHeight).toHaveBeenLastCalledWith(56)
    expect(setHeight).toHaveBeenCalledTimes(2)

    cleanup!()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
