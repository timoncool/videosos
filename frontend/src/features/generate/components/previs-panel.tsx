import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Film, ImagePlay, Images, Loader2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useEditorStore } from '@/shared/state/editor'
import { useProjectStore } from '../deps/editor'
import { blockShot } from '../services/prompt-assist'
import { createPrevisRenderer, type PrevisRenderer } from '../services/previs-render'
import {
  examplePrevisScene,
  normalizePrevisScene,
  type PrevisScene,
  type PrevisView,
} from '../services/previs-scene'
import { importPrevisFrame, importPrevisVideo, PREVIS_PATH_COLOR } from '../services/previs-shot'
import { aspectOf } from '../services/storyboard'
import { useGenerateStore, type PendingUse } from '../stores/generate-store'

const VIEWS: PrevisView[] = ['camera', 'top', 'orbit']

/**
 * 3D blocking, as AIMovieStudio's previs and AI Canvas's director desk: the shot described in words is built by
 * the prompt model as stand-in shapes, moves and a camera path, looked at through the camera, from above and
 * around, and its frame or camera video goes into a generation as the first frame or the reference.
 */
export function PrevisPanel() {
  const { t } = useTranslation()
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const metadata = useProjectStore((state) => state.currentProject?.metadata)
  const blocking = useGenerateStore((state) => (projectId ? state.blockings[projectId] : undefined))
  const assistant = useGenerateStore((state) => state.assistant)
  const canAssist = useGenerateStore(
    (state) => state.assistant === 'agent' || state.keys.openrouter === true,
  )
  const [description, setDescription] = useState(blocking?.description ?? '')
  const [json, setJson] = useState('')
  const [view, setView] = useState<PrevisView>('camera')
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState<'build' | 'change' | 'apply' | 'frame' | 'video' | null>(null)
  const [share, setShare] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const mount = useRef<HTMLDivElement | null>(null)
  const renderer = useRef<PrevisRenderer | null>(null)
  const scene = blocking?.scene ?? null
  const width = metadata?.width ?? 1920
  const height = metadata?.height ?? 1080
  const aspect = width / height

  useEffect(() => {
    setJson(scene ? JSON.stringify(scene, null, 2) : '')
    setTime(0)
    setPlaying(false)
  }, [scene])

  useEffect(() => {
    if (!scene || !mount.current) return
    const made = createPrevisRenderer(mount.current, scene, aspect, PREVIS_PATH_COLOR)
    renderer.current = made
    return () => {
      renderer.current = null
      made.dispose()
    }
  }, [scene, aspect])

  useEffect(() => {
    renderer.current?.draw(time, view)
  }, [scene, time, view])

  useEffect(() => {
    if (!playing || !scene) return
    let frame = 0
    const started = performance.now()
    const from = time >= scene.seconds ? 0 : time
    const tick = (now: number) => {
      const next = Math.min(scene.seconds, from + (now - started) / 1000)
      setTime(next)
      if (next >= scene.seconds) setPlaying(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // the start time is read once when playing begins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, scene])

  if (!projectId)
    return <p className="p-3 text-xs text-muted-foreground">{t('generate.storyboard.noProject')}</p>

  const keep = (next: PrevisScene | null, words = description) =>
    useGenerateStore.getState().setBlocking(projectId, { description: words, scene: next })

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<string | void>) => {
    setError(null)
    setDone(null)
    setBusy(kind)
    try {
      const said = await work()
      if (said) setDone(said)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  const build = (change: boolean) =>
    run(change ? 'change' : 'build', async () => {
      keep(
        await blockShot(description, aspectOf(width, height), change ? scene : null),
        description,
      )
    })

  const apply = () =>
    run('apply', async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch (failure) {
        throw new Error(
          t('generate.previs.badJson', {
            reason: failure instanceof Error ? failure.message : String(failure),
          }),
        )
      }
      keep(normalizePrevisScene(parsed))
    })

  const name = (kind: 'frame' | 'video') =>
    t(kind === 'frame' ? 'generate.previs.frameName' : 'generate.previs.videoName', {
      title: scene?.title ?? '',
    })

  const takeFrame = (use: Omit<PendingUse, 'ref' | 'kind'>) =>
    run('frame', async () => {
      if (!renderer.current) throw new Error(t('generate.previs.noView'))
      setPlaying(false)
      const media = await importPrevisFrame(renderer.current, time, name('frame'))
      useEditorStore.getState().setActiveTab('generate')
      useGenerateStore.getState().useAs({ ...use, kind: 'image', ref: { media } })
    })

  const makeVideo = () =>
    run('video', async () => {
      if (!renderer.current) throw new Error(t('generate.previs.noView'))
      setPlaying(false)
      setShare(0)
      await importPrevisVideo(renderer.current, name('video'), setShare)
      return t('generate.previs.videoDone', { name: name('video') })
    })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="previs-panel">
      <div className="space-y-3 p-3">
        <p className="text-[11px] text-muted-foreground">
          {t(`generate.previs.hint.${assistant}`)}
        </p>
        <div className="space-y-1">
          <Label htmlFor="previs-description" className="text-[11px] text-muted-foreground">
            {t('generate.previs.description')}
          </Label>
          <Textarea
            id="previs-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('generate.previs.placeholder')}
            className="min-h-20 resize-y text-xs"
          />
        </div>
        <Button
          className="bg-brand h-9 w-full gap-2"
          disabled={busy !== null || !description.trim() || !canAssist}
          title={canAssist ? undefined : t('generate.improve.needsKey')}
          onClick={() => void build(false)}
        >
          {busy === 'build' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Box className="h-4 w-4" />
          )}
          {busy === 'build' ? t('generate.previs.building') : t('generate.previs.build')}
        </Button>
        {scene && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full gap-1.5 text-[11px]"
            disabled={busy !== null || !description.trim() || !canAssist}
            onClick={() => void build(true)}
          >
            {busy === 'change' && <Loader2 className="h-3 w-3 animate-spin" />}
            {busy === 'change' ? t('generate.previs.building') : t('generate.previs.change')}
          </Button>
        )}
        {!scene && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={busy !== null}
            onClick={() => keep(examplePrevisScene())}
          >
            {t('generate.previs.example')}
          </Button>
        )}
        {error && (
          <p className="break-words rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            {t('generate.previs.failed', { reason: error })}
          </p>
        )}
        {scene && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium">{scene.title}</span>
                <div
                  className="flex shrink-0 rounded-md bg-[var(--color-surface-2)] p-0.5"
                  role="group"
                  aria-label={t('generate.previs.views')}
                >
                  {VIEWS.map((each) => (
                    <button
                      key={each}
                      type="button"
                      aria-pressed={view === each}
                      onClick={() => setView(each)}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${view === each ? 'bg-[var(--color-overlay)] text-[var(--color-text)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                    >
                      {t(`generate.previs.view.${each}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div
                ref={mount}
                className="w-full overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]"
                style={{ aspectRatio: `${width} / ${height}` }}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={playing ? t('generate.previs.pause') : t('generate.previs.play')}
                  onClick={() => setPlaying(!playing)}
                  disabled={busy !== null}
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={scene.seconds}
                  step={0.01}
                  value={time}
                  aria-label={t('generate.previs.time')}
                  onChange={(event) => {
                    setPlaying(false)
                    setTime(Number(event.target.value))
                  }}
                  className="min-w-0 flex-1 accent-[var(--color-accent)]"
                />
                <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                  {time.toFixed(1)} / {scene.seconds.toFixed(1)}
                </span>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
                disabled={busy !== null}
                onClick={() => void takeFrame({ task: 'video', roles: ['first_frame'] })}
              >
                <ImagePlay className="h-3.5 w-3.5" />
                {t('generate.previs.toVideo')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
                disabled={busy !== null}
                onClick={() =>
                  void takeFrame({ task: 'image_edit', roles: ['source', 'reference'] })
                }
              >
                <Images className="h-3.5 w-3.5" />
                {t('generate.previs.toPicture')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
                disabled={busy !== null}
                onClick={() => void makeVideo()}
              >
                {busy === 'video' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Film className="h-3.5 w-3.5" />
                )}
                {busy === 'video'
                  ? t('generate.previs.recording', { percent: Math.round(share * 100) })
                  : t('generate.previs.video')}
              </Button>
            </div>
            {done && <p className="text-[11px] text-muted-foreground">{done}</p>}
            <details className="rounded-md border border-[var(--color-border)]">
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] text-muted-foreground">
                {t('generate.previs.json')}
              </summary>
              <div className="space-y-1.5 p-2 pt-0">
                <Textarea
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  spellCheck={false}
                  aria-label={t('generate.previs.json')}
                  className="min-h-48 resize-y bg-secondary/30 font-mono text-[10px]"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 w-full text-xs"
                  disabled={busy !== null}
                  onClick={() => void apply()}
                >
                  {t('generate.previs.apply')}
                </Button>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
