import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { PERSON_ONLY } from '@/shared/utils/person'
import { startBridge } from './bridge'

class FakeSource {
  static last: FakeSource | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeSource.last = this
  }
  close() {}
}

describe('the window bridge', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it("refuses an agent's click on a control only the person may press", async () => {
    const answers: Array<{ id: string; result?: unknown; error?: string }> = []
    vi.stubGlobal('EventSource', FakeSource)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/mcp/window/result') answers.push(JSON.parse(String(init?.body)))
        return new Response('{}')
      }),
    )
    const pressed = vi.fn()
    const record = document.createElement('button')
    record.textContent = 'Record'
    record.setAttribute(Object.keys(PERSON_ONLY)[0]!, '')
    record.addEventListener('click', pressed)
    record.getBoundingClientRect = () => ({
      width: 20,
      height: 20,
      top: 0,
      left: 0,
      right: 20,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    document.body.append(record)

    startBridge()
    const source = FakeSource.last!
    source.onmessage!({ data: JSON.stringify({ window: 1 }) })
    source.onmessage!({
      data: JSON.stringify({ window: 1, id: 'c1', command: 'click', args: { text: 'Record' } }),
    })
    await vi.waitFor(() => expect(answers).toHaveLength(1))

    expect(answers[0]!.error).toMatch(/Only the person turns the microphone on/)
    expect(pressed).not.toHaveBeenCalled()
  })
})
