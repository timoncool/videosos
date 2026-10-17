import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MCP = readFileSync(join(ROOT, '..', 'crates', 'vs-server', 'src', 'mcp.rs'), 'utf8')
const SERVICES = join(import.meta.dirname)
const BRIDGE = readFileSync(join(SERVICES, 'bridge.ts'), 'utf8')
const STUDIO_COMMANDS = readFileSync(join(SERVICES, 'studio-commands.ts'), 'utf8')

interface Tool {
  name: string
  looks: boolean
  command: string | null
  block: string
}

/** The tools as `mcp.rs` declares them, each with the window command it sends, if it sends one. */
const tools: Tool[] = MCP.split(/\n\s*Tool \{/)
  .slice(1)
  .map((block) => ({
    name: /^\s*name: "(\w+)"/.exec(block)?.[1] ?? '',
    looks: /looks: true/.test(block),
    command: /call: \|\w*\| window\("(\w+)"/.exec(block)?.[1] ?? null,
    block,
  }))
  .filter((tool) => tool.name)

function sourcesOf(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sourcesOf(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')
      ? [readFileSync(path, 'utf8')]
      : []
  })
}

const pageSources = sourcesOf(join(SERVICES, '..'))
const registered = new Set(
  pageSources.flatMap((source) =>
    [...source.matchAll(/registerBridgeCommand\('(\w+)'/g)].map((m) => m[1]!),
  ),
)
const builtInBlock = BRIDGE.slice(
  BRIDGE.indexOf('const builtIn: Record<string, Handler> = {'),
  BRIDGE.indexOf('\n}\n', BRIDGE.indexOf('const builtIn')),
)
const builtIn = new Set([...builtInBlock.matchAll(/^ {2}(?:async )?(\w+)(?:\(|: \()/gm)].map((m) => m[1]!))
const looking = new Set(
  [
    ...BRIDGE.slice(BRIDGE.indexOf('const LOOKING'))
      .split('])')[0]!
      .matchAll(/'(\w+)'/g),
  ].map((m) => m[1]!),
)

/** The top-level properties a tool's schema names. */
function schemaFields(tool: Tool): string[] | null {
  if (/schema: nothing/.test(tool.block)) return []
  const open = tool.block.indexOf('object(json!({')
  if (open < 0) return null
  const fields: string[] = []
  let depth = 0
  for (let at = open + 'object(json!('.length; at < tool.block.length; at++) {
    const c = tool.block[at]
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) break
    } else if (c === '"') {
      const end = tool.block.indexOf('"', at + 1)
      if (depth === 1 && /^\s*:/.test(tool.block.slice(end + 1)))
        fields.push(tool.block.slice(at + 1, end))
      at = end
    }
  }
  return fields
}

/** The fields a page command takes, from its `takeArgs`. */
function takenFields(command: string, tool: string): string[] | null {
  const name = [command, tool].find((each) =>
    pageSources.some((source) => source.includes(`takeArgs('${each}', args, [`)),
  )
  if (!name) return null
  const source = pageSources.find((each) => each.includes(`takeArgs('${name}', args, [`))!
  const start = source.indexOf(`takeArgs('${name}', args, [`)
  const list = source.slice(start, source.indexOf('])', start))
  return [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]!).slice(1)
}

describe("the agent's tools and the window", () => {
  const windowTools = tools.filter((tool) => tool.command)

  it('reads the tools from the server', () => {
    expect(tools.length).toBeGreaterThan(100)
    expect(windowTools.length).toBeGreaterThan(50)
  })

  it('every tool has a unique name', () => {
    const names = tools.map((tool) => tool.name)
    expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([])
  })

  it('every command a tool sends is answered by the window', () => {
    expect(
      windowTools
        .filter((tool) => !registered.has(tool.command!) && !builtIn.has(tool.command!))
        .map((tool) => tool.name),
    ).toEqual([])
  })

  it('every command the window answers is a tool of the agent', () => {
    // a tool that does more than ask the window asks it from its own code
    const asked = [...MCP.matchAll(/ask_window\("(\w+)"/g)].map((m) => m[1]!)
    const sent = new Set([...windowTools.map((tool) => tool.command), ...asked])
    expect([...registered, ...builtIn].filter((command) => !sent.has(command))).toEqual([])
  })

  it('each command takes the fields its tool offers', () => {
    let compared = 0
    for (const tool of windowTools) {
      const offered = schemaFields(tool)
      const taken = takenFields(tool.command!, tool.name)
      if (offered === null || taken === null) continue
      compared++
      expect([...taken].sort(), tool.name).toEqual([...offered].sort())
    }
    expect(compared).toBeGreaterThan(40)
  })

  it('a tool that only looks is not shown as an action of the agent', () => {
    expect(
      windowTools
        .filter((tool) => tool.looks && !looking.has(tool.command!))
        .map((tool) => tool.name),
    ).toEqual([])
  })
})

describe('the journal in every language', () => {
  it('has the words for every change an agent makes', () => {
    const table = MCP.slice(
      MCP.indexOf('const JOURNAL:'),
      MCP.indexOf('];', MCP.indexOf('const JOURNAL:')),
    )
    const facts = [...table.matchAll(/\("\w+", "([\w ]+)", "([\w ]+)"\)/g)]
    expect(facts.length).toBeGreaterThan(40)
    const verbs = new Set(facts.map((fact) => fact[1]!))
    const kinds = new Set(facts.map((fact) => fact[2]!))
    const partials = join(ROOT, 'src', 'i18n', 'locales', 'partials')
    for (const language of readdirSync(partials)) {
      const journal = (
        JSON.parse(readFileSync(join(partials, language, 'studio.json'), 'utf8')) as {
          journal: { verb: Record<string, string>; kind: Record<string, string> }
        }
      ).journal
      const missing = [
        ...[...verbs].filter((verb) => !journal.verb[verb]).map((verb) => `verb ${verb}`),
        ...[...kinds].filter((kind) => !journal.kind[kind]).map((kind) => `kind ${kind}`),
      ]
      expect(missing, language).toEqual([])
    }
  })
})

describe("the window's settings", () => {
  it("each one an agent can change, or it is the person's with a reason", () => {
    const store = readFileSync(
      join(ROOT, 'src', 'features', 'settings', 'stores', 'settings-store.ts'),
      'utf8',
    )
    const defaults = store.slice(
      store.indexOf('const DEFAULT_SETTINGS: AppSettings = {'),
      store.indexOf('\n}\n', store.indexOf('const DEFAULT_SETTINGS')),
    )
    const keys = [...defaults.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!)
    const settable = STUDIO_COMMANDS.slice(
      STUDIO_COMMANDS.indexOf('const WINDOW_SETTINGS = ['),
      STUDIO_COMMANDS.indexOf('] as const', STUDIO_COMMANDS.indexOf('const WINDOW_SETTINGS')),
    )
    const forAgents = new Set([...settable.matchAll(/'(\w+)'/g)].map((m) => m[1]!))
    // the person's own: the shortcuts their hands know and where they dragged the timeline's divider
    const persons = new Set(['hotkeyOverrides', 'timelineSectionDividerPosition'])
    expect(keys.length).toBeGreaterThan(10)
    expect(keys.filter((key) => !forAgents.has(key) && !persons.has(key))).toEqual([])
  })
})
