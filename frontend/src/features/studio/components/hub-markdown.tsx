import { hubInline } from '../services/hub-inline'

/** The hub's markdown: paragraphs and "- " lists of `hubInline` text. */
export function HubMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {text
        .split(/\n\s*\n/)
        .filter((block) => block.trim())
        .map((block, b) => {
          const lines = block.split('\n').filter((line) => line.trim())
          if (lines.every((line) => line.trimStart().startsWith('- '))) {
            return (
              <ul key={b} className="list-disc space-y-1 pl-5">
                {lines.map((line, l) => (
                  <li key={l}>{hubInline(line.trimStart().slice(2), `${b}-${l}`)}</li>
                ))}
              </ul>
            )
          }
          return <p key={b}>{hubInline(lines.join(' '), String(b))}</p>
        })}
    </div>
  )
}
