import { create } from 'zustand'
import type { TimelineCommand, CommandEntry, TimelineSnapshot } from './commands/types'
import { captureSnapshot, restoreSnapshot, snapshotsEqual } from './commands/snapshot'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { formatTimelineCommandLabel } from './commands/labels'
import { emitUiSound } from '@/shared/ui/ui-sound'

/**
 * Sentinel context key for the Main timeline (activeCompositionId === null).
 * Undo/redo history is scoped per editing context so an entry captured while
 * one sequence/composition is live can never be applied while another is live
 * (which would restore the wrong content into the live domain stores).
 */
export const ROOT_HISTORY_CONTEXT = '__root__'

function historyContextKey(compositionId: string | null): string {
  return compositionId ?? ROOT_HISTORY_CONTEXT
}

interface HistoryStacks {
  undoStack: CommandEntry[]
  redoStack: CommandEntry[]
}

/**
 * Command store state.
 * Maintains undo/redo stacks and provides atomic history management.
 *
 * `undoStack`/`redoStack` are always the *active* context's stacks. Inactive
 * contexts' stacks are parked in `stacksByContext` and swapped in by
 * {@link CommandStoreActions.setActiveContext} when navigation changes which
 * sequence/composition is live.
 */
interface CommandStoreState {
  undoStack: CommandEntry[]
  redoStack: CommandEntry[]
  canUndo: boolean
  canRedo: boolean
  /** Parked stacks for non-active contexts, keyed by composition id / root sentinel. */
  stacksByContext: Record<string, HistoryStacks>
  /** The context key whose stacks are currently in undoStack/redoStack. */
  activeContextKey: string
}

/**
 * Command store actions.
 * The execute() function is the core API - it captures state before running an action.
 */
interface CommandStoreActions {
  /**
   * Execute a command with automatic undo support.
   * Captures a snapshot before running the action, enabling undo.
   *
   * @param command - Metadata about the command being executed
   * @param action - The function that performs the actual state changes
   * @returns The return value of the action function
   */
  execute: <T>(command: TimelineCommand, action: () => T) => T

  /**
   * Undo the last command.
   * Restores the state from before the command was executed.
   */
  undo: () => void

  /**
   * Redo a previously undone command.
   * Restores the state from after the command was executed.
   */
  redo: () => void

  /**
   * Clear all history.
   * Called when loading a new project or resetting the timeline.
   */
  clearHistory: () => void

  /**
   * Get the last command type (for debugging/UI).
   */
  getLastCommandType: () => string | null

  /**
   * Get the next undo command label for UI affordances.
   */
  getUndoLabel: () => string | null

  /**
   * Get the next redo command label for UI affordances.
   */
  getRedoLabel: () => string | null

  /**
   * Add a pre-captured snapshot to the undo stack.
   * Used for drag operations where snapshot is captured at start and committed at end.
   */
  addUndoEntry: (command: TimelineCommand, beforeSnapshot: TimelineSnapshot) => void

  /**
   * Switch the active undo/redo context to the given composition (null = Main
   * timeline). Parks the current stacks and swaps in the target context's
   * stacks (empty if none). Called by composition navigation whenever the live
   * timeline content changes, so undo/redo always operate on the content that
   * is actually on screen.
   */
  setActiveContext: (compositionId: string | null) => void

  /**
   * Drop a composition's parked undo/redo history entirely. Called when the
   * composition is deleted so its stack chain can't linger in memory or be
   * reused. If it happens to be the active context, its live stacks are cleared.
   */
  removeContext: (compositionId: string) => void
}

export const useTimelineCommandStore = create<CommandStoreState & CommandStoreActions>()(
  (set, get) => ({
    // State
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
    stacksByContext: {},
    activeContextKey: ROOT_HISTORY_CONTEXT,

    // Execute a command
    execute: <T>(command: TimelineCommand, action: () => T): T => {
      const beforeSnapshot = captureSnapshot()

      // Execute the action
      const result = action()

      // Capture after state to check if anything changed
      const afterSnapshot = captureSnapshot()

      // Only add to history if state actually changed
      if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
        const maxHistory = useSettingsStore.getState().maxUndoHistory
        set((state) => ({
          undoStack: [
            ...state.undoStack.slice(-(maxHistory - 1)),
            { command, beforeSnapshot, timestamp: Date.now() },
          ],
          redoStack: [], // Clear redo on new action
          canUndo: true,
          canRedo: false,
        }))
      }

      return result
    },

    // Undo
    undo: () => {
      const { undoStack } = get()
      if (undoStack.length === 0) return

      // Capture current state for redo
      const currentSnapshot = captureSnapshot()
      const entry = undoStack[undoStack.length - 1]!

      // Restore previous state
      restoreSnapshot(entry.beforeSnapshot)
      emitUiSound('select')

      set((state) => ({
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [
          ...state.redoStack,
          { command: entry.command, beforeSnapshot: currentSnapshot, timestamp: entry.timestamp },
        ],
        canUndo: state.undoStack.length > 1,
        canRedo: true,
      }))
    },

    // Redo
    redo: () => {
      const { redoStack } = get()
      if (redoStack.length === 0) return

      // Capture current state for undo
      const currentSnapshot = captureSnapshot()
      const entry = redoStack[redoStack.length - 1]!

      // Restore the "after" state (which is stored in beforeSnapshot after undo swapped it)
      restoreSnapshot(entry.beforeSnapshot)
      emitUiSound('select')

      set((state) => ({
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [
          ...state.undoStack,
          { command: entry.command, beforeSnapshot: currentSnapshot, timestamp: entry.timestamp },
        ],
        canUndo: true,
        canRedo: state.redoStack.length > 1,
      }))
    },

    // Clear history — wipes every context, not just the active one.
    clearHistory: () =>
      set({
        undoStack: [],
        redoStack: [],
        canUndo: false,
        canRedo: false,
        stacksByContext: {},
        activeContextKey: ROOT_HISTORY_CONTEXT,
      }),

    // Get last command type
    getLastCommandType: () => {
      const { undoStack } = get()
      if (undoStack.length === 0) return null
      const entry = undoStack[undoStack.length - 1]
      return entry ? entry.command.type : null
    },

    getUndoLabel: () => {
      const { undoStack } = get()
      if (undoStack.length === 0) return null
      const entry = undoStack[undoStack.length - 1]
      return entry ? formatTimelineCommandLabel(entry.command) : null
    },

    getRedoLabel: () => {
      const { redoStack } = get()
      if (redoStack.length === 0) return null
      const entry = redoStack[redoStack.length - 1]
      return entry ? formatTimelineCommandLabel(entry.command) : null
    },

    // Add pre-captured snapshot to undo stack (for drag operations)
    addUndoEntry: (command: TimelineCommand, beforeSnapshot: TimelineSnapshot) => {
      const afterSnapshot = captureSnapshot()

      // Only add to history if state actually changed
      if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
        const maxHistory = useSettingsStore.getState().maxUndoHistory
        set((state) => ({
          undoStack: [
            ...state.undoStack.slice(-(maxHistory - 1)),
            { command, beforeSnapshot, timestamp: Date.now() },
          ],
          redoStack: [], // Clear redo on new action
          canUndo: true,
          canRedo: false,
        }))
      }
    },

    setActiveContext: (compositionId) => {
      const key = historyContextKey(compositionId)
      const state = get()
      if (key === state.activeContextKey) return

      const incoming = state.stacksByContext[key] ?? { undoStack: [], redoStack: [] }
      // Park the active stacks under their key; pull the target out of the map.
      const { [key]: _incoming, ...others } = state.stacksByContext
      set({
        stacksByContext: {
          ...others,
          [state.activeContextKey]: { undoStack: state.undoStack, redoStack: state.redoStack },
        },
        activeContextKey: key,
        undoStack: incoming.undoStack,
        redoStack: incoming.redoStack,
        canUndo: incoming.undoStack.length > 0,
        canRedo: incoming.redoStack.length > 0,
      })
    },

    removeContext: (compositionId) => {
      const key = historyContextKey(compositionId)
      const state = get()
      if (key === state.activeContextKey) {
        set({ undoStack: [], redoStack: [], canUndo: false, canRedo: false })
        return
      }
      if (!(key in state.stacksByContext)) return
      const { [key]: _removed, ...others } = state.stacksByContext
      set({ stacksByContext: others })
    },
  }),
)
