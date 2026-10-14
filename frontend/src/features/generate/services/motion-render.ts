/**
 * HTML and CSS motion graphics made into a clip, as WeftCut's Motifs and HyperFrames make them: the code runs in
 * a frame with no scripts, its CSS animations are paused and stepped frame by frame, each frame is drawn and
 * encoded with its transparency (VP9 in WebM), so a title or a lower third lies over the video below it.
 */

export interface MotionOptions {
  width: number
  height: number
  fps: number
  seconds: number
}

function page(html: string, width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html{color-scheme:dark}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}</style></head><body>${html}</body></html>`
}

async function frameOf(html: string, width: number, height: number): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }))
  frame.srcdoc = page(html, width, height)
  document.body.appendChild(frame)
  await loaded
  await frame.contentDocument?.fonts.ready
  return frame
}

/** Renders the code into a WebM clip with transparency; `progress` hears the share of frames done. */
export async function renderMotion(html: string, options: MotionOptions, progress?: (share: number) => void): Promise<Blob> {
  const { width, height, fps, seconds } = options
  const { domToCanvas } = await import('modern-screenshot')
  const { Output, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } = await import('mediabunny')
  const frame = await frameOf(html, width, height)
  try {
    const document = frame.contentDocument
    if (!document) throw new Error('the code did not open')
    const animations = document.getAnimations()
    for (const animation of animations) animation.pause()
    const canvas = window.document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('the window cannot draw the frames')
    const target = new BufferTarget()
    const output = new Output({ format: new WebMOutputFormat(), target })
    const source = new CanvasSource(canvas, { codec: 'vp9', quality: QUALITY_HIGH, alpha: 'keep' })
    output.addVideoTrack(source, { frameRate: fps })
    await output.start()
    const total = Math.max(1, Math.round(seconds * fps))
    for (let index = 0; index < total; index++) {
      const time = index / fps
      for (const animation of animations) animation.currentTime = time * 1000
      const shot = await domToCanvas(document.documentElement, { width, height, backgroundColor: null })
      context.clearRect(0, 0, width, height)
      context.drawImage(shot, 0, 0, width, height)
      await source.add(time, 1 / fps)
      progress?.((index + 1) / total)
    }
    await output.finalize()
    if (!target.buffer) throw new Error('the clip came out empty')
    return new Blob([target.buffer], { type: 'video/webm' })
  } finally {
    frame.remove()
  }
}

/** Ready motion graphics to start from: the code is the person's to change. */
export const MOTION_TEMPLATES: Array<{ id: string; seconds: number; html: string }> = [
  {
    id: 'title',
    seconds: 4,
    html: `<style>
.title{position:absolute;inset:0;display:grid;place-items:center;font:800 140px/1 Onest,system-ui,sans-serif;color:#fff;letter-spacing:-2px}
.title span{display:inline-block;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;color:transparent;animation:rise 1.2s cubic-bezier(.2,.8,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(60px) scale(.96);filter:blur(12px)}to{opacity:1;transform:none;filter:none}}
</style>
<div class="title"><span>Your title</span></div>`,
  },
  {
    id: 'lowerThird',
    seconds: 5,
    html: `<style>
.lt{position:absolute;left:120px;bottom:140px;font-family:Onest,system-ui,sans-serif;color:#fff}
.bar{height:8px;width:0;background:#a78bfa;border-radius:4px;animation:grow .6s ease-out .1s forwards}
.name{font-weight:700;font-size:64px;line-height:1.1;margin-top:16px;opacity:0;animation:fade .6s ease-out .4s forwards}
.role{font-size:36px;line-height:1.2;color:#d4d4d8;opacity:0;animation:fade .6s ease-out .7s forwards}
@keyframes grow{to{width:420px}}
@keyframes fade{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
</style>
<div class="lt"><div class="bar"></div><div class="name">Name Surname</div><div class="role">Role or subtitle</div></div>`,
  },
  {
    id: 'counter',
    seconds: 3,
    html: `<style>
@property --n{syntax:'<integer>';initial-value:0;inherits:false}
.counter{position:absolute;inset:0;display:grid;place-items:center;font:800 220px/1 'JetBrains Mono',monospace;color:#fbbf24;counter-reset:n var(--n);animation:count 2.4s ease-out forwards}
.counter::after{content:counter(n) '%'}
@keyframes count{to{--n:100}}
</style>
<div class="counter"></div>`,
  },
  {
    id: 'badge',
    seconds: 3,
    html: `<style>
.badge{position:absolute;top:80px;right:80px;padding:18px 32px;border-radius:999px;font:700 40px/1 Onest,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#7c3aed,#2563eb);box-shadow:0 12px 40px rgb(124 58 237 / .45);animation:pop .5s cubic-bezier(.3,1.6,.5,1) both}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
</style>
<div class="badge">NEW</div>`,
  },
]
