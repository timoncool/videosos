/**
 * An agent's timeline edit as a proposal, as OpenChatCut shows its agent's: when the person asked for it
 * (Settings, Agents), the window rehearses the edit, shows what will change and waits for Accept or Decline
 * before anything is touched. Without an answer the proposal is withdrawn before the agent's call runs out.
 */

import { create } from 'zustand'
import type { EditOp } from '@/headless/edit-op-support'
import { useItemsStore, useMediaLibraryStore } from '../deps/editor'

export interface ProposalLine {
  key: string
  values: Record<string, string | number>
}

export interface Proposal {
  lines: ProposalLine[]
  /** How many of the ops the rehearsal could apply, and why it stopped if it did. */
  wouldApply: number
  problem: string | null
}

interface ProposalState {
  proposal: Proposal | null
  answer: ((accepted: boolean) => void) | null
  ask: (proposal: Proposal) => Promise<boolean>
  decide: (accepted: boolean) => void
}

/** The agent's call waits five minutes; the person has a little less, so the agent hears the answer. */
const ANSWER_WITHIN_MS = 280_000

export const useProposalStore = create<ProposalState>((set, get) => ({
  proposal: null,
  answer: null,
  ask: (proposal) => {
    get().answer?.(false)
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => get().decide(false), ANSWER_WITHIN_MS)
      set({
        proposal,
        answer: (accepted) => {
          window.clearTimeout(timer)
          resolve(accepted)
        },
      })
    })
  },
  decide: (accepted) => {
    const answer = get().answer
    set({ proposal: null, answer: null })
    answer?.(accepted)
  },
}))

/** Each op in the person's words: what it adds, moves, cuts or removes, by the names they see. */
export function describeOps(ops: EditOp[], fps: number): ProposalLine[] {
  const { itemById } = useItemsStore.getState()
  const { mediaById } = useMediaLibraryStore.getState()
  const at = (frames: unknown) =>
    typeof frames === 'number' ? Math.round((frames / fps) * 10) / 10 : 0
  const itemName = (id: unknown) => (typeof id === 'string' ? (itemById[id]?.label ?? id) : '?')
  const { tracks } = useItemsStore.getState()
  const trackName = (id: unknown) => tracks.find((track) => track.id === id)?.name ?? String(id)
  return ops.map((op): ProposalLine => {
    switch (op.op) {
      case 'addClip':
        return {
          key: 'addClip',
          values: {
            name: mediaById[String(op.mediaId)]?.fileName ?? String(op.mediaId),
            at: at(op.from),
          },
        }
      case 'addText':
        return { key: 'addText', values: { text: String(op.text ?? ''), at: at(op.from) } }
      case 'moveItem':
        return { key: 'moveItem', values: { name: itemName(op.id), at: at(op.from) } }
      case 'removeItems':
        return {
          key: 'removeItems',
          values: { names: (Array.isArray(op.ids) ? op.ids : []).map(itemName).join(', ') },
        }
      case 'split':
        return { key: 'split', values: { name: itemName(op.id), at: at(op.frame) } }
      case 'trimStart':
      case 'trimEnd': {
        const amount = Number(op.amount) || 0
        // trimStart cuts with a positive amount, trimEnd with a negative one
        const cuts = op.op === 'trimStart' ? amount > 0 : amount < 0
        return {
          key: `${op.op}${cuts ? 'Cut' : 'Extend'}`,
          values: { name: itemName(op.id), seconds: at(Math.abs(amount)) },
        }
      }
      case 'addShape':
        return {
          key: 'addShape',
          values: { shape: String(op.shape ?? 'rectangle'), at: at(op.from) },
        }
      case 'updateTrack':
      case 'removeTrack':
        return { key: op.op, values: { name: trackName(op.id) } }
      case 'addMarker':
        return { key: 'addMarker', values: { label: String(op.label ?? ''), at: at(op.frame) } }
      case 'updateMarker':
      case 'removeMarker':
        return { key: op.op, values: {} }
      default:
        return { key: 'other', values: { op: op.op, name: itemName(op.id ?? op.itemId) } }
    }
  })
}
