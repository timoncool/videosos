# FreeCut Web

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in dev (shown by default)

## Toolchain & dependency notes

- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`). `onnxruntime-web` (dev build) and `lucide-react` (0.468.x) are pinned **deliberately** — never routine-bump either
- **Never bulk-`fallow fix`.** The `check:unused-exports` / `check:unused-class-members` allowlists are ratchet baselines, not approvals — trace per export

## Git

- This frontend is part of VideoSOS: branches, pull requests, commit messages and the changelog follow the repository root's `AGENTS.md`
