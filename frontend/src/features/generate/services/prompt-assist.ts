/**
 * Rewrites a prompt for the chosen task and model with an LLM of OpenRouter, or writes one from a picture,
 * through the same job queue as every generation, so the call is priced and kept in the history (outside any
 * project).
 */

import { generateApi, type MediaRef, type Task } from './generate-api'

const PROMPT_MODEL = 'google/gemini-3.8-flash'

const GOALS: Partial<Record<Task, string>> = {
  image: 'a still image: subject, composition, lens and framing, lighting, color palette, style, mood',
  image_edit: 'an edit of a given image: say exactly what changes and what must stay the same',
  video: 'a short video shot: subject and action over time, camera movement, framing, lighting, style, sound if any',
  video_edit: 'an edit of a given video: what changes, what stays',
  lip_sync: 'a talking head: who speaks, expression, framing',
  music: 'a piece of music: genre, mood, tempo, instruments, structure, vocals or instrumental',
  speech: 'text to be read aloud: keep the meaning, make it natural to say',
  sound: 'a sound effect: source, space, distance, duration, texture',
  text: 'a request to a language model',
}

/** Runs one text request of the prompt model through the job queue and waits for its answer. */
async function runText(values: Record<string, unknown>): Promise<string> {
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
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error ?? job.status)
    if (job.status === 'done') {
      const text = job.outputs.find((output) => output.kind === 'text')?.text?.trim()
      if (!text) throw new Error('the model answered without text')
      return text
    }
  }
}

export async function improvePrompt(prompt: string, task: Task, modelName: string): Promise<string> {
  const goal = GOALS[task] ?? 'the request'
  const system = `You improve prompts for the generative model "${modelName}". The prompt describes ${goal}. Rewrite it into one vivid, specific prompt in the same language as the original, keeping every detail the person gave and adding what the model needs. Answer with the prompt only, no quotes, no comments.`
  return runText({ prompt, system, temperature: 0.6 })
}

/** A prompt that would make the picture, written by a model that sees it: the reverse prompt. */
export async function describeImage(image: MediaRef, task: Task, modelName: string, language: string): Promise<string> {
  // a picture is described as it is: an edit task's goal would invent a change instead
  const goal = task === 'video' || task === 'lip_sync' ? GOALS.video : GOALS.image
  const system = `You write prompts for the generative model "${modelName}". Look at the picture and write the prompt that would make it, as ${goal}. Write it in the language with the code "${language}". Answer with the prompt only, no quotes, no comments.`
  return runText({ prompt: 'Write the prompt for this picture.', system, temperature: 0.4, input_images: [image] })
}
