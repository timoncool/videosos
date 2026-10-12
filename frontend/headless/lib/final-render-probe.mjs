import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const positiveInteger = (value, name) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${name}`)
  return parsed
}

const gcd = (left, right) => {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

const rational = (value) => {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '')
  if (!match) throw new Error('Invalid frame rate')
  const numerator = positiveInteger(match[1], 'frame-rate numerator')
  const denominator = positiveInteger(match[2], 'frame-rate denominator')
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

export function parseFinalRenderProbe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid ffprobe response')
  }
  const containers = new Set(String(value.format?.format_name ?? '').split(','))
  if (!containers.has('mp4')) throw new Error('Final render container is not MP4')
  const streams = Array.isArray(value.streams) ? value.streams : []
  const videos = streams.filter((stream) => stream?.codec_type === 'video')
  const audios = streams.filter((stream) => stream?.codec_type === 'audio')
  if (videos.length !== 1 || audios.length !== 1) {
    throw new Error('Final render must contain exactly one video and one audio stream')
  }
  const video = videos[0]
  const audio = audios[0]
  const durationSeconds = Number(value.format?.duration)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Invalid final render duration')
  }
  return {
    width: positiveInteger(video.width, 'video width'),
    height: positiveInteger(video.height, 'video height'),
    durationMillis: Math.round(durationSeconds * 1000),
    videoCodec: String(video.codec_name ?? ''),
    pixelFormat: String(video.pix_fmt ?? ''),
    frameRate: rational(video.avg_frame_rate || video.r_frame_rate),
    audioCodec: String(audio.codec_name ?? ''),
    audioSampleRateHz: positiveInteger(audio.sample_rate, 'audio sample rate'),
    audioChannels: positiveInteger(audio.channels, 'audio channel count'),
  }
}

export async function probeFinalRenderArtifact(file) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,sample_rate,channels',
      '-of',
      'json',
      '--',
      file,
    ],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  )
  return parseFinalRenderProbe(JSON.parse(stdout))
}

export async function conformFinalRenderArtifact(file, profile) {
  const conformed = `${file}.conformed.mp4`
  await fs.promises.rm(conformed, { force: true })
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-vf',
        `scale=${profile.width}:${profile.height}:flags=lanczos,fps=${profile.frameRate.numerator}/${profile.frameRate.denominator}`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        profile.pixelFormat,
        '-c:a',
        profile.audioCodec,
        '-ar',
        String(profile.audioSampleRateHz),
        '-ac',
        String(profile.audioChannels),
        '-movflags',
        '+faststart',
        conformed,
      ],
      { encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 1024 * 1024 },
    )
    await fs.promises.rm(file, { force: true })
    await fs.promises.rename(conformed, file)
  } catch (error) {
    await fs.promises.rm(conformed, { force: true }).catch(() => {})
    throw error
  }
}
