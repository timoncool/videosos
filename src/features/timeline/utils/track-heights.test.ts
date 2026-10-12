import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { COMPACT_TRACK_HEIGHT, DEFAULT_TRACK_HEIGHT, MAX_TRACK_HEIGHT } from '../constants'
import {
  clearAllTrackHeightOverrides,
  clearTrackHeightOverride,
  flushTrackHeightOverrides,
  loadTrackHeightOverrides,
  resolveTrackHeight,
  setTrackHeightOverride,
} from './track-heights'

describe('track-heights', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAllTrackHeightOverrides()
    useEditorStore.getState().setTrackSizePreset('medium')
    loadTrackHeightOverrides('project-a')
  })

  it('falls back to the preset for tracks with no override', () => {
    expect(resolveTrackHeight('v1')).toBe(DEFAULT_TRACK_HEIGHT)

    useEditorStore.getState().setTrackSizePreset('compact')
    expect(resolveTrackHeight('v1')).toBe(COMPACT_TRACK_HEIGHT)
  })

  it('clamps overrides into the supported range', () => {
    setTrackHeightOverride('v1', MAX_TRACK_HEIGHT + 500)
    expect(resolveTrackHeight('v1')).toBe(MAX_TRACK_HEIGHT)
  })

  it('does not store an override equal to the preset, so a preset change still moves the track', () => {
    setTrackHeightOverride('v1', DEFAULT_TRACK_HEIGHT)
    useEditorStore.getState().setTrackSizePreset('large')

    expect(resolveTrackHeight('v1')).toBe(MAX_TRACK_HEIGHT)
  })

  it('keeps a real override pinned across preset changes until cleared', () => {
    setTrackHeightOverride('v1', 88)
    useEditorStore.getState().setTrackSizePreset('large')
    expect(resolveTrackHeight('v1')).toBe(88)

    clearTrackHeightOverride('v1')
    expect(resolveTrackHeight('v1')).toBe(MAX_TRACK_HEIGHT)
  })

  it('scopes overrides per project and restores them on reload', () => {
    setTrackHeightOverride('track-1', 88)
    flushTrackHeightOverrides()

    // Default track ids collide across projects, so project B must not inherit.
    loadTrackHeightOverrides('project-b')
    expect(resolveTrackHeight('track-1')).toBe(DEFAULT_TRACK_HEIGHT)

    loadTrackHeightOverrides('project-a')
    expect(resolveTrackHeight('track-1')).toBe(88)
  })

  it('flushes pending overrides before switching projects', () => {
    setTrackHeightOverride('track-1', 120)
    // No explicit flush: switching projects must not lose the debounced write.
    loadTrackHeightOverrides('project-b')
    loadTrackHeightOverrides('project-a')

    expect(resolveTrackHeight('track-1')).toBe(120)
  })
})
