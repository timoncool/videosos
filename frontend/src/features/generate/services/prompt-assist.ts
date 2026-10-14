/**
 * Rewrites a prompt for the chosen task and model, writes one from a picture, splits a script and builds a
 * blocking: with the agent connected over MCP when the person made it the assistant (it is a language model
 * itself, so nothing is paid), otherwise with an LLM of OpenRouter through the same job queue as every
 * generation, so the call is priced and kept in the history (outside any project).
 */

import { generateApi, type MediaRef, type Task } from './generate-api'
import { parsePrevisAnswer, previsInstruction, type PrevisScene } from './previs-scene'
import guides from '../../../../../crates/vs-server/src/prompt-guides.json'

const PROMPT_MODEL = 'google/gemini-3.8-flash'

const GOALS: Partial<Record<Task, string>> = guides.goals

/** A rule of the guide with its {placeholders} filled. */
function rule(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  )
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
  const system = rule(guides.improve, { model: modelName, goal })
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
  const goal = task === 'video' || task === 'lip_sync' ? guides.goals.video : guides.goals.image
  const system = rule(guides.describe, { model: modelName, goal, language })
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
  const system = rule(guides.storyboard, { count, goal: guides.goals.video, language })
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
