# FreeCut Web

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in dev (shown by default)

## Toolchain & dependency notes

- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`). `onnxruntime-web` (dev build) and `lucide-react` (0.468.x) are pinned **deliberately** — never routine-bump either
- **Never bulk-`fallow fix`.** The `check:unused-exports` / `check:unused-class-members` allowlists are ratchet baselines, not approvals — trace per export

## Git

- `main` — production, `staging` — pre-release integration, `develop` — active development
- Commit work straight to `develop` — do **not** cut feature branches
- PR target: `staging` (`develop` PRs into `staging`; `staging` is promoted to `main`). Do **not** open PRs against `main` directly
- Conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)
