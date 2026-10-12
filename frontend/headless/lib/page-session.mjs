/**
 * One-shot harness page for CLI drivers (frame/layout/edit): launches Chrome,
 * mirrors page errors to stderr, waits for the engine to become ready, runs
 * `operation(page)` and always tears the browser down. `ignoreConsoleError`
 * filters known-noisy console errors (media probes, favicon) from the mirror.
 */
export async function withHarnessPage(options, operation) {
  const { chromium } = await import('playwright')
  const {
    harnessUrl,
    headless = true,
    launchArgs,
    acceptDownloads = false,
    ignoreConsoleError = () => false,
  } = options
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    ...(launchArgs ? { args: launchArgs } : {}),
  })
  try {
    const context = await browser.newContext(acceptDownloads ? { acceptDownloads: true } : {})
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && !ignoreConsoleError(m.text())) {
        console.error('  [page:error]', m.text())
      }
    })
    await page.goto(harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    return await operation(page)
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function probeGpu(page) {
  return page
    .evaluate(async () => {
      if (!globalThis.navigator?.gpu) return { available: false }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) return { available: false }
      const info = adapter.info ?? {}
      return {
        available: true,
        vendor: info.vendor ?? '',
        architecture: info.architecture ?? '',
        description: info.description ?? '',
      }
    })
    .catch(() => ({ available: false }))
}

/** Owns the disposable browser context/page used by the warm service. */
export class PageSession {
  #context
  #page

  constructor({ browser, harnessUrl, onPageError = () => {}, onProgress = () => {} }) {
    this.browser = browser
    this.harnessUrl = harnessUrl
    this.onPageError = onPageError
    this.onProgress = onProgress
  }

  get page() {
    if (!this.#page) throw new Error('Browser page session is not ready')
    return this.#page
  }

  async open() {
    const context = await this.browser.newContext({ acceptDownloads: true })
    try {
      const page = await context.newPage()
      page.on('pageerror', this.onPageError)
      await page.exposeBinding('__freecutProgress', (_source, progress) =>
        this.onProgress(progress),
      )
      await page.goto(this.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
      await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
      this.#context = context
      this.#page = page
      return page
    } catch (error) {
      await context.close().catch(() => {})
      throw error
    }
  }

  async recreate() {
    await this.close()
    return this.open()
  }

  async close() {
    const context = this.#context
    this.#context = undefined
    this.#page = undefined
    await context?.close().catch(() => {})
  }
}
