/**
 * Variables in a prompt, as the competitors' prompt templates have them: `{{subject}}` in any text of the form
 * is asked for once beside it and filled in when the job is sent, so one saved prompt serves many runs.
 */

const VARIABLE = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu

/** The variables the form's texts use, in the order they first appear. */
export function variablesOf(values: Record<string, unknown>): string[] {
  const names: string[] = []
  for (const value of Object.values(values)) {
    if (typeof value !== 'string') continue
    for (const match of value.matchAll(VARIABLE)) {
      const name = match[1]
      if (name && !names.includes(name)) names.push(name)
    }
  }
  return names
}

/** The form's values with every variable put in. */
export function fillVariables(
  values: Record<string, unknown>,
  variables: Record<string, string>,
): Record<string, unknown> {
  const filled: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    filled[key] =
      typeof value === 'string'
        ? value.replace(VARIABLE, (whole, name: string) => variables[name] ?? whole)
        : value
  }
  return filled
}
