import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
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

const answers = new Map<string, { result?: unknown; error?: string }>()
let nextId = 1

/** Sends the window a command as the service does and waits for its answer. */
async function command(name: string, args: Record<string, unknown> = {}) {
  const id = `c${nextId++}`
  FakeSource.last!.onmessage!({ data: JSON.stringify({ window: 1, id, command: name, args }) })
  await vi.waitFor(() => expect(answers.has(id)).toBe(true))
  return answers.get(id)!
}

describe('the window bridge', () => {
  beforeAll(() => {
    vi.stubGlobal('EventSource', FakeSource)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/mcp/window/result') {
          const { id, ...answer } = JSON.parse(String(init?.body))
          answers.set(id, answer)
        }
        return new Response('{}')
      }),
    )
    // jsdom lays nothing out: every element gets a box, so the bridge counts it as drawn
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
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
    Element.prototype.scrollIntoView = () => {}
    startBridge()
    FakeSource.last!.onmessage!({ data: JSON.stringify({ window: 1 }) })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it("refuses an agent's click on a control only the person may press", async () => {
    const pressed = vi.fn()
    const record = document.createElement('button')
    record.textContent = 'Record'
    record.setAttribute(Object.keys(PERSON_ONLY)[0]!, '')
    record.addEventListener('click', pressed)
    document.body.append(record)

    const answer = await command('click', { text: 'Record' })

    expect(answer.error).toMatch(/Only the person turns the microphone on/)
    expect(pressed).not.toHaveBeenCalled()
  })

  it('reads a folded section as the person sees it', async () => {
    document.body.innerHTML = `
      <details><summary>Details</summary><button>Hidden inside</button></details>
      <details open><summary>Scene JSON</summary><button>Shown inside</button></details>`

    const page = ((await command('read_page')).result as { text: string }).text

    expect(page).toMatch(/section "Details" closed/)
    expect(page).toMatch(/section "Scene JSON" open/)
    expect(page).not.toMatch(/Hidden inside/)
    expect(page).toMatch(/Shown inside/)
  })

  it("names a field by its label's own words, not the options inside it", async () => {
    document.body.innerHTML = `
      <label>Quality<span>best for export</span><select><option>High</option><option>Low</option></select></label>`

    const page = ((await command('read_page')).result as { text: string }).text

    expect(page).toMatch(/select "Quality best for export"/)
  })

  it('saves a field typed into while the window is in the background', async () => {
    // a window in the background: focus() and blur() send no events of their own
    const background = [
      vi.spyOn(document, 'hasFocus').mockReturnValue(false),
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {}),
      vi.spyOn(HTMLElement.prototype, 'blur').mockImplementation(() => {}),
    ]
    document.body.innerHTML = `<label>Name<input /></label>`
    const left = vi.fn()
    document.querySelector('input')!.addEventListener('focusout', left)

    const answer = await command('type', { text: 'Name', value: 'Boat' })

    expect(answer.error).toBeUndefined()

    expect(document.querySelector('input')!.value).toBe('Boat')
    expect(left).toHaveBeenCalled()
    for (const spy of background) spy.mockRestore()
  })
})
