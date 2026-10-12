#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, chromeLaunchArgs } from './lib/cli.mjs'
import {
  capabilities,
  HEADLESS_API_VERSION,
  projectCreateRequestSchema,
  projectSaveRequestSchema,
  projectUpdateRequestSchema,
  lifecycleEditRequestSchema,
  mediaProbeRequestSchema,
  validate,
} from './lib/contract.mjs'
import { prepareJob, renderJob, startHarness } from './lib/render-core.mjs'
import { PageSession } from './lib/page-session.mjs'
import { collectAddClipMedia, resolveMediaFile } from './lib/workspace.mjs'
import {
  acquireWriterLock,
  assertAtomicReplace,
  commitStagedMedia,
  createProjectResource,
  getMediaResource,
  getProjectResource,
  listMediaResources,
  listProjectResources,
  projectForEngine,
  publicProjectResource,
  rollbackStagedMedia,
  saveProjectResource,
  stageLocalMedia,
  updateMediaMetadata,
} from './lib/lifecycle-store.mjs'

const OPTIONS = new Set([
  'workspace',
  'json',
  'id',
  'name',
  'description',
  'width',
  'height',
  'fps',
  'background-color',
  'file',
  'ops',
  'persist',
  'expected-revision',
  'force',
  'project',
  'build',
  'harness-url',
  'head',
  'break-lock',
  'out',
  'codec',
  'container',
  'resolution',
  'quality',
  'duration',
  'in',
  'out-sec',
  'audio-only',
  'allow-missing-media',
])

const envelope = (value) => ({ ok: true, apiVersion: HEADLESS_API_VERSION, ...value })
const number = (value) => (value === undefined ? undefined : Number(value))
const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))

async function withBrowser(workspace, args, operation) {
  const { chromium } = await import('playwright')
  const harness = await startHarness({ workspace, devUrl: args['harness-url'], build: args.build })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.head,
    args: chromeLaunchArgs(),
  })
  const session = new PageSession({ browser, harnessUrl: harness.harnessUrl })
  try {
    await session.open()
    return await operation(session.page, harness.mediaUrlOf)
  } finally {
    await session.close().catch(() => {})
    await browser.close().catch(() => {})
    await harness.closeServers().catch(() => {})
  }
}

async function withWriter(workspace, args, operation) {
  if (args['break-lock'])
    console.error('Attempting explicit recovery of a confirmed-dead workspace writer lock')
  const release = await acquireWriterLock(workspace, { breakLock: Boolean(args['break-lock']) })
  try {
    await assertAtomicReplace(workspace)
    return await operation()
  } finally {
    await release()
  }
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { allowed: OPTIONS })
  const [group, action] = args._
  const workspace = path.resolve(args.workspace ?? '.')
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`)
  if (group === 'capabilities') return envelope(capabilities())
  if (!action && group !== 'render')
    throw new Error('Expected a command such as project list or media import')

  if (group === 'project' && action === 'list')
    return envelope({ projects: await listProjectResources(workspace), nextCursor: null })
  if (group === 'project' && action === 'get')
    return envelope(publicProjectResource(await getProjectResource(workspace, args.id)))
  if (group === 'media' && action === 'list')
    return envelope({ media: await listMediaResources(workspace) })
  if (group === 'media' && action === 'get')
    return envelope(await getMediaResource(workspace, args.id))
  if (group === 'render') {
    if (!args.project) throw new Error('--project is required')
    return withBrowser(workspace, args, async (page, mediaUrlOf) => {
      const job = prepareJob(
        workspace,
        {
          project: args.project,
          ...(args.out ? { out: args.out } : {}),
          ...(args.codec ? { codec: args.codec } : {}),
          ...(args.container ? { container: args.container } : {}),
          ...(args.resolution ? { resolution: args.resolution } : {}),
          ...(args.fps ? { fps: args.fps } : {}),
          ...(args.quality ? { quality: args.quality } : {}),
          ...(args.duration ? { duration: args.duration } : {}),
          ...(args.in ? { in: args.in } : {}),
          ...(args['out-sec'] ? { 'out-sec': args['out-sec'] } : {}),
          ...(args['audio-only'] ? { 'audio-only': true } : {}),
        },
        mediaUrlOf,
      )
      const summary = await renderJob(page, job, {
        allowMissingMedia: Boolean(args['allow-missing-media']),
        downloadTimeoutMs: 0,
      })
      return envelope(summary)
    })
  }

  return withWriter(workspace, args, async () => {
    if (group === 'project' && action === 'create') {
      const input = validate(projectCreateRequestSchema, {
        ...(args.id ? { id: args.id } : {}),
        name: args.name,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.width ? { width: number(args.width) } : {}),
        ...(args.height ? { height: number(args.height) } : {}),
        ...(args.fps ? { fps: number(args.fps) } : {}),
        ...(args['background-color'] ? { backgroundColor: args['background-color'] } : {}),
      })
      const project = await withBrowser(workspace, args, (page) =>
        page.evaluate((value) => window.freecut.createProject(value), input),
      )
      return envelope(await createProjectResource(workspace, project))
    }
    if (group === 'project' && action === 'save') {
      if (!args.file) throw new Error('--file is required')
      const body = validate(projectSaveRequestSchema, {
        project: readJson(args.file),
        expectedRevision: args['expected-revision'],
        force: Boolean(args.force),
      })
      if (body.project.id !== undefined && body.project.id !== args.id)
        throw new Error('Project body id must equal --id')
      const project = await withBrowser(workspace, args, (page) =>
        page.evaluate((value) => window.freecut.normalizeProject(value), {
          ...body.project,
          id: args.id,
        }),
      )
      return envelope(
        publicProjectResource(await saveProjectResource(workspace, args.id, project, body)),
      )
    }
    if (group === 'project' && action === 'update') {
      const body = validate(projectUpdateRequestSchema, {
        updates: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.width ? { width: number(args.width) } : {}),
          ...(args.height ? { height: number(args.height) } : {}),
          ...(args.fps ? { fps: number(args.fps) } : {}),
          ...(args['background-color'] ? { backgroundColor: args['background-color'] } : {}),
        },
        expectedRevision: args['expected-revision'],
        force: Boolean(args.force),
      })
      const current = await getProjectResource(workspace, args.id)
      const next = {
        ...projectForEngine(current.project),
        ...body.updates,
        metadata: {
          ...current.project.metadata,
          ...(body.updates.width !== undefined ? { width: body.updates.width } : {}),
          ...(body.updates.height !== undefined ? { height: body.updates.height } : {}),
          ...(body.updates.fps !== undefined ? { fps: body.updates.fps } : {}),
          ...(body.updates.backgroundColor !== undefined
            ? { backgroundColor: body.updates.backgroundColor }
            : {}),
        },
      }
      delete next.width
      delete next.height
      delete next.fps
      delete next.backgroundColor
      const project = await withBrowser(workspace, args, (page) =>
        page.evaluate((value) => window.freecut.normalizeProject(value), next),
      )
      return envelope(
        publicProjectResource(await saveProjectResource(workspace, args.id, project, body)),
      )
    }
    if (group === 'project' && action === 'edit') {
      if (!args.ops) throw new Error('--ops is required')
      const body = validate(lifecycleEditRequestSchema, {
        ops: readJson(args.ops),
        persist: Boolean(args.persist),
        expectedRevision: args['expected-revision'],
        force: Boolean(args.force),
      })
      const current = await getProjectResource(workspace, args.id)
      const result = await withBrowser(workspace, args, async (page) => {
        const edited = await page.evaluate((payload) => window.freecut.editProject(payload), {
          project: projectForEngine(current.project),
          ops: body.ops,
          media: collectAddClipMedia(workspace, body.ops),
        })
        if (!body.persist) return edited
        return {
          ...edited,
          project: await page.evaluate(
            (value) => window.freecut.normalizeProject(value),
            edited.project,
          ),
        }
      })
      if (!body.persist)
        return envelope({ ...result, persisted: false, baseRevision: current.revision })
      const saved = await saveProjectResource(workspace, args.id, result.project, body)
      return envelope({
        ...result,
        project: projectForEngine(saved.project),
        persisted: true,
        revision: saved.revision,
        warnings: saved.warnings,
      })
    }
    if (group === 'media' && action === 'probe') {
      const body = validate(mediaProbeRequestSchema, {
        persist: Boolean(args.persist),
        expectedRevision: args['expected-revision'],
        force: Boolean(args.force),
      })
      const current = await getMediaResource(workspace, args.id)
      const source = resolveMediaFile(workspace, args.id)
      if (!source) throw new Error('Media source file is missing')
      const probe = await withBrowser(workspace, args, (page, mediaUrlOf) =>
        page.evaluate((payload) => window.freecut.probeMedia(payload), {
          url: mediaUrlOf(args.id),
          fileName: path.basename(source),
          mimeType: current.metadata.mimeType,
        }),
      )
      if (!body.persist) return envelope({ mediaId: args.id, probe, persisted: false })
      const saved = await updateMediaMetadata(workspace, args.id, probe, body)
      return envelope({ mediaId: args.id, probe, persisted: true, revision: saved.revision })
    }
    if (group === 'media' && action === 'import') {
      if (!args.file) throw new Error('--file is required')
      let staged
      try {
        staged = await stageLocalMedia(workspace, args.file, args.id)
        const probe = await withBrowser(workspace, args, (page, mediaUrlOf) =>
          page.evaluate((payload) => window.freecut.probeMedia(payload), {
            url: mediaUrlOf(staged.id),
            fileName: path.basename(staged.target),
            mimeType: staged.mimeType,
          }),
        )
        const media = await commitStagedMedia(staged, probe, { workspace, projectId: args.project })
        return envelope({
          media,
          duplicate: false,
          ...(args.project ? { associatedProjectId: args.project } : {}),
        })
      } catch (error) {
        if (staged) await rollbackStagedMedia(staged)
        throw error
      }
    }
    throw new Error(`Unknown command: ${group} ${action}`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          ok: false,
          apiVersion: HEADLESS_API_VERSION,
          error: {
            code: error.code ?? 'INTERNAL_ERROR',
            message: error.message,
            fields: error.fields ?? [],
          },
        }),
      )
      process.exitCode = 1
    })
}

export { run }
