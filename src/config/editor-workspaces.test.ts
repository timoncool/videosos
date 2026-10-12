import { describe, expect, it } from 'vite-plus/test'
import { normalizeEditorWorkspaceId } from './editor-workspaces'

describe('normalizeEditorWorkspaceId', () => {
  it('uses Motion as the workspace id and migrates former Animate and Compose ids', () => {
    expect(normalizeEditorWorkspaceId('motion')).toBe('motion')
    expect(normalizeEditorWorkspaceId('animate')).toBe('motion')
    expect(normalizeEditorWorkspaceId('compose')).toBe('motion')
  })
})
