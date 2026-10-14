// The server routes the studio parts of the window read: folders, the resource monitor, the agents' status.

export type AppPaths = {
  data_dir: string
  projects_dir: string
  generations_dir: string
  exports_dir: string
  logs_dir: string
}
export type McpStatus = {
  agent_connected: boolean
  agent_last_call: string | null
  agent_seconds_ago: number | null
  agent_calls: number
  window_open?: boolean
}
export type HwSnapshot = {
  gpuName: string
  totalVram: number
  usedVram: number
  freeVram: number
  gpuUtilization: number
  temperature: number
  powerDraw: number
  powerLimit: number
  processRam: number
  totalRam: number
  usedRam: number
  message: string
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return (await response.json()) as T
}

export const api = {
  appPaths: () => getJson<AppPaths>('/api/app/paths'),
  info: () => getJson<{ version: string; system: string }>('/api/info'),
  hwSnapshot: () => getJson<HwSnapshot>('/api/hw/snapshot'),
  mcpStatus: () => getJson<McpStatus>('/api/agent/status'),
  mcpUrl: () => `${window.location.origin.replace('localhost', '127.0.0.1')}/mcp`,
  /** Whether the program's service answers; a network failure is `false`, anything else is thrown. */
  serverReachable: async (): Promise<boolean> => {
    try {
      const response = await fetch('/health', { cache: 'no-store' })
      return response.ok
    } catch {
      return false
    }
  },
  reveal: async (path: string): Promise<void> => {
    const response = await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!response.ok)
      throw new Error(
        ((await response.json().catch(() => ({}))) as { error?: string }).error ??
          `HTTP ${response.status}`,
      )
  },
}
