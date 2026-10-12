export type SelectionSnapTarget = {
  frame: number
  type: 'grid' | 'item-start' | 'item-end' | 'playhead'
  itemId?: string
} | null

export type SelectionLinkedDropTarget = {
  trackId: string
  zone: 'video' | 'audio'
  createNew?: boolean
} | null

export type SelectionDragState = {
  isDragging: boolean
  draggedItemIds: string[]
  draggedItemIdSet?: Set<string>
  draggedTrackIds?: string[] // For track dragging
  draggedTrackIdSet?: Set<string>
  offset: { x: number; y: number }
  isAltDrag?: boolean // Whether Alt key is held (triggers duplication)
} | null

export interface SelectionState {
  selectedItemIds: string[]
  selectedItemIdSet: Set<string>
  selectedMarkerId: string | null // Selected marker ID
  selectedTransitionId: string | null // Selected transition ID
  selectedTrackId: string | null // Deprecated: use activeTrackId
  selectedTrackIds: string[] // Multi-track selection
  activeTrackId: string | null // Single active track
  selectionType: 'item' | 'track' | 'marker' | 'transition' | null
  activeTool: 'select' | 'trim-edit' | 'razor' | 'rate-stretch' | 'slip' | 'slide' // Active timeline tool
  activeSnapTarget: SelectionSnapTarget
  activeLinkedDropTarget: SelectionLinkedDropTarget
  // Drag state for visual feedback
  dragState: SelectionDragState
  /** Whether Edit's bottom keyframe panel is visible, independently of clip selection. */
  editKeyframePanelOpen: boolean
  /** Current Edit keyframe panel target. Kept as a set for compatibility; at most one ID is stored. */
  expandedKeyframeLanes: Set<string>
}

export interface SelectionActions {
  selectItems: (ids: string[]) => void
  selectMarker: (id: string | null) => void // Select a marker
  selectTransition: (id: string | null) => void // Select a transition
  selectTrack: (id: string | null) => void // Deprecated: use setActiveTrack
  selectTracks: (ids: string[], append?: boolean) => void
  setActiveTrack: (id: string | null) => void
  toggleTrackSelection: (id: string) => void
  clearSelection: () => void
  clearItemSelection: () => void // Clears only items, preserves track selection
  setDragState: (dragState: SelectionState['dragState']) => void
  setActiveSnapTarget: (target: SelectionSnapTarget) => void
  setActiveLinkedDropTarget: (target: SelectionLinkedDropTarget) => void
  setActiveTool: (tool: SelectionState['activeTool']) => void
  // Edit keyframe panel visibility
  toggleEditKeyframePanel: () => void
  setEditKeyframePanelOpen: (open: boolean) => void
  toggleKeyframeLanes: (itemId: string) => void
  setKeyframeLanesExpanded: (itemId: string, expanded: boolean) => void
}
