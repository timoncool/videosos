/**
 * Rewrites a prompt for the chosen task and model, writes one from a picture, splits a script and builds a
 * blocking: with the agent connected over MCP when the person made it the assistant (it is a language model
 * itself, so nothing is paid), otherwise with an LLM of OpenRouter through the same job queue as every
 * generation, so the call is priced and kept in the history (outside any project).
 */

import { generateApi, type MediaRef, type Task } from './generate-api'
import { parsePrevisAnswer, previsInstruction, type PrevisScene } from './previs-scene'

const PROMPT_MODEL = 'google/gemini-3.8-flash'

const GOALS: Partial<Record<Task, string>> = {
  image:
    'a still image: subject, composition, lens and framing, lighting, color palette, style, mood',
  image_edit: 'an edit of a given image: say exactly what changes and what must stay the same',
  video:
    'a short video shot: subject and action over time, camera movement, framing, lighting, style, sound if any',
  video_edit: 'an edit of a given video: what changes, what stays',
  lip_sync: 'a talking head: who speaks, expression, framing',
  music: 'a piece of music: genre, mood, tempo, instruments, structure, vocals or instrumental',
  speech: 'text to be read aloud: keep the meaning, make it natural to say',
  sound: 'a sound effect: source, space, distance, duration, texture',
  text: 'a request to a language model',
}

/** One question of the assistant: to the connected agent when it is the assistant, otherwise to the prompt model. */
async function runText(
  target: string,
  values: { prompt: string; system: string; temperature: number; input_images?: MediaRef[] },
): Promise<string> {
  const settings = await generateApi.settings()
  if (settings.assistant === 'agent') {
    const { answer } = await generateApi.askAgent({
      target,
      instructions: values.system,
      request: values.prompt,
      images: values.input_images ?? [],
      project_id: null,
    })
    const text = answer.trim()
    if (!text) throw new Error('the agent answered with nothing')
    return text
  }
  return runModel(values)
}

/** Runs one text request of the prompt model through the job queue and waits for its answer. */
async function runModel(values: Record<string, unknown>): Promise<string> {
  const { jobs } = await generateApi.createJobs({
    provider: 'openrouter',
    model: PROMPT_MODEL,
    task: 'text',
    values,
    project_id: null,
    repeat: 1,
    place: false,
    place_at: null,
  })
  const id = jobs[0]?.id
  if (!id) throw new Error('the server did not start the job')
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    const job = await generateApi.job(id)
    if (job.status === 'failed' || job.status === 'cancelled')
      throw new Error(job.error ?? job.status)
    if (job.status === 'done') {
      const text = job.outputs.find((output) => output.kind === 'text')?.text?.trim()
      if (!text) throw new Error('the model answered without text')
      return text
    }
  }
}

export async function improvePrompt(
  prompt: string,
  task: Task,
  modelName: string,
): Promise<string> {
  const goal = GOALS[task] ?? 'the request'
  const system = `You improve prompts for the generative model "${modelName}". The prompt describes ${goal}. Rewrite it into one vivid, specific prompt in the same language as the original, keeping every detail the person gave and adding what the model needs. Answer with the prompt only, no quotes, no comments.`
  return runText('improve_prompt', { prompt, system, temperature: 0.6 })
}

/** A prompt that would make the picture, written by a model that sees it: the reverse prompt. */
export async function describeImage(
  image: MediaRef,
  task: Task,
  modelName: string,
  language: string,
): Promise<string> {
  // a picture is described as it is: an edit task's goal would invent a change instead
  const goal = task === 'video' || task === 'lip_sync' ? GOALS.video : GOALS.image
  const system = `You write prompts for the generative model "${modelName}". Look at the picture and write the prompt that would make it, as ${goal}. Write it in the language with the code "${language}". Answer with the prompt only, no quotes, no comments.`
  return runText('describe_image', {
    prompt: 'Write the prompt for this picture.',
    system,
    temperature: 0.4,
    input_images: [image],
  })
}

/** A script split into shots by the prompt model: each shot's prompt for a video model and its length. */
export async function splitScript(
  script: string,
  count: number,
  language: string,
): Promise<Array<{ prompt: string; seconds: number }>> {
  const system = `You are a storyboard artist. Split the script into exactly ${count} shots of a short video. For each shot write one prompt for a video model: ${GOALS.video}. Describe every recurring character, object and place the same way in every shot, and keep words starting with @ exactly as they are. Write the prompts in the language with the code "${language}". Give each shot a length of 2 to 10 seconds. Answer with a JSON array only, no comments: [{"prompt": "...", "seconds": 5}]`
  const text = await runText('split_script', { prompt: script, system, temperature: 0.5 })
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`the model did not answer with a list of shots: ${text.slice(0, 200)}`)
  }
  if (!Array.isArray(parsed))
    throw new Error(`the model did not answer with a list of shots: ${text.slice(0, 200)}`)
  const shots = parsed.flatMap((each: unknown) => {
    if (!each || typeof each !== 'object') return []
    const { prompt, seconds } = each as { prompt?: unknown; seconds?: unknown }
    if (typeof prompt !== 'string' || !prompt.trim()) return []
    const length =
      typeof seconds === 'number' && Number.isFinite(seconds)
        ? Math.min(10, Math.max(2, seconds))
        : 5
    return [{ prompt: prompt.trim(), seconds: length }]
  })
  if (shots.length === 0) throw new Error(`the model answered with no shot: ${text.slice(0, 200)}`)
  return shots
}

/** A 3D blocking of the shot the words describe, built by the prompt model, or the current one changed by them. */
export async function blockShot(
  description: string,
  aspect: string,
  current: PrevisScene | null,
): Promise<PrevisScene> {
  const text = await runText('blocking', {
    prompt: description,
    system: previsInstruction(aspect, current),
    temperature: 0.4,
  })
  return parsePrevisAnswer(text)
}
