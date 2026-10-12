#!/usr/bin/env node
// Produce Istanbul-format coverage for headless/**.mjs.
//
// The headless suite runs under `node --test` and as standalone driver scripts,
// so Vitest's coverage never sees it. Fallow's CRAP metric then scores every
// headless function as if it had zero coverage, which buries real complexity
// findings under noise. This collects V8 coverage across the whole portable
// suite (child processes inherit NODE_V8_COVERAGE, so the `serve.mjs` spawned
// by the lifecycle e2e is covered too), converts it to Istanbul format, and
// writes `.coverage/headless.json` for `check:changed-health` to hand to Fallow.
//
// Run: npm run coverage:headless
//      node scripts/headless-coverage.mjs --from <dir>   (convert an existing
//      NODE_V8_COVERAGE directory instead of re-running the suite — CI already
//      runs the suite once, and it is minutes long)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import libCoverage from 'istanbul-lib-coverage'
import v8toIstanbul from 'v8-to-istanbul'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COVERAGE_DIR = path.join(ROOT, '.coverage')
const V8_DIR = path.join(COVERAGE_DIR, 'v8')
const OUT_FILE = path.join(COVERAGE_DIR, 'headless.json')
const HEADLESS_PREFIX = `${path.join(ROOT, 'headless')}${path.sep}`

function runSuite() {
  const result = spawnSync('npm', ['run', 'headless:test:portable'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_V8_COVERAGE: V8_DIR },
    // npm is a .cmd shim on Windows, which spawnSync cannot exec directly.
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`headless:test:portable exited with ${result.status}`)
  }
}

/** Own source only: skip node internals, dependencies, and the tests themselves. */
function isCoverableHeadlessScript(url) {
  if (!url.startsWith('file:')) return false
  const filePath = fileURLToPath(url)
  return (
    filePath.startsWith(HEADLESS_PREFIX) &&
    !filePath.includes(`${path.sep}node_modules${path.sep}`) &&
    filePath.endsWith('.mjs') &&
    !filePath.endsWith('.test.mjs')
  )
}

/**
 * V8 reports only the functions a given process actually instrumented, so each
 * process yields a different function/statement map for the same file. Merging
 * raw counters would attach one process's counts to another's map — let
 * istanbul-lib-coverage do the key remapping instead.
 */
async function collect() {
  const map = libCoverage.createCoverageMap({})
  let processes = 0
  for (const entry of fs.readdirSync(V8_DIR)) {
    if (!entry.endsWith('.json')) continue
    const raw = JSON.parse(fs.readFileSync(path.join(V8_DIR, entry), 'utf8'))
    processes += 1
    for (const script of raw.result ?? []) {
      if (!isCoverableHeadlessScript(script.url)) continue
      const filePath = fileURLToPath(script.url)
      if (!fs.existsSync(filePath)) continue
      const converter = v8toIstanbul(filePath, 0, {
        source: fs.readFileSync(filePath, 'utf8'),
      })
      await converter.load()
      converter.applyCoverage(script.functions)
      map.merge(converter.toIstanbul())
      converter.destroy()
    }
  }
  return { merged: map.toJSON(), processes }
}

const fromIndex = process.argv.indexOf('--from')
const reuseDir = fromIndex >= 0 ? path.resolve(process.argv[fromIndex + 1] ?? '') : null
if (reuseDir) {
  if (!fs.existsSync(reuseDir)) throw new Error(`--from directory not found: ${reuseDir}`)
  if (reuseDir !== V8_DIR) {
    fs.mkdirSync(V8_DIR, { recursive: true })
    for (const entry of fs.readdirSync(reuseDir)) {
      if (entry.endsWith('.json')) fs.copyFileSync(path.join(reuseDir, entry), path.join(V8_DIR, entry))
    }
  }
} else {
  fs.rmSync(COVERAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(V8_DIR, { recursive: true })
  runSuite()
}

const { merged, processes } = await collect()
if (Object.keys(merged).length === 0) {
  throw new Error(`No headless coverage found under ${path.relative(ROOT, V8_DIR)}`)
}
// v8-to-istanbul emits -1 for positions it could not resolve; Fallow's parser
// expects u32 and rejects the whole file, so clamp them to zero.
let clamped = 0
const sanitized = JSON.parse(JSON.stringify(merged), (_key, value) =>
  typeof value === 'number' && value < 0 ? (clamped++, 0) : value,
)
fs.writeFileSync(OUT_FILE, JSON.stringify(sanitized))
console.log(
  `Wrote ${path.relative(ROOT, OUT_FILE)}: ${Object.keys(sanitized).length} files from ${processes} processes (${clamped} unresolved positions clamped).`,
)