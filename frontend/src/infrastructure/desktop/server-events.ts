/** What the VideoSOS server announces: a job moved, a key was set, the journal got a line. */
export interface ServerEventMessage {
  kind: string
  data?: unknown
}

type Listener = (event: ServerEventMessage) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null

/** One stream of server events per page, shared by every subscriber. */
export function onServerEvent(listener: Listener): () => void {
  listeners.add(listener)
  if (!source) {
    source = new EventSource('/api/events')
    source.onmessage = (message: MessageEvent<string>) => {
      let event: ServerEventMessage
      try {
        event = JSON.parse(message.data) as ServerEventMessage
      } catch {
        return
      }
      for (const each of listeners) each(event)
    }
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && source) {
      source.close()
      source = null
    }
  }
}
