import { execute } from './shared'

/** Several edits as one step of the history: undo takes them back together. */
export function asOneStep<T>(type: string, action: () => T): T {
  return execute(type, action)
}
