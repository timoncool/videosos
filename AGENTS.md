# VideoSOS guidelines

VideoSOS is a desktop studio for AI video: generation through OpenRouter, fal and Runware on the person's own
keys, and a multitrack editor. It is a Tauri 2 shell (`desktop/src-tauri`), a Rust/axum service
(`crates/vs-server`, port 8796) with the providers' clients (`crates/vs-providers`), and a React 19 + Vite
single-page window (`frontend/`, a FreeCut fork kept as a git subtree). An MCP server at `/mcp` gives agents the
same routes the window uses.

## Stack

- Do not add Python or Node.js to the runtime path. Node builds the window only; nothing of the shipped program
  may need it.
- Generation goes through the three providers' HTTP APIs only. Every model, field and price comes from the
  providers' own catalogues and schemas (`crates/vs-providers`); do not hard-code a model list, a price or a form.
- Programs VideoSOS downloads on demand (yt-dlp, deno, ffmpeg) are pinned in `crates/vs-server/src/tools.rs` by
  URL, size and SHA-256; a new version is a new pin, checked the same way. yt-dlp's own daily update is checked
  against its release's SHA2-256SUMS (`ytdlp.rs`).
- The editor's export runs in the window (WebCodecs); do not move it to a server-side encoder.
- Icons come from `lucide-react`. Do not hand-draw SVG paths.

## Code

- No silent fallbacks: no swallowed errors, no empty `catch`, no "try X, then Y" without saying so. When
  something breaks, return an error with the cause (a code the window words in its language, and the detail)
  and let the window show it.
- Comments say only what the code cannot: a non-obvious invariant. No change history, no restating the code, no
  comments in CSS.
- The frontend's feature boundaries are enforced: a feature reaches another only through its
  `features/<x>/deps/*-contract.ts` and the adapter beside it. `npm run check` fails otherwise.
- An agent's change goes through the same route as the window's, and every MCP tool that changes something has a
  journal line or is named among the window's own controls (`mcp.rs`, test
  `every_change_an_agent_can_make_is_journaled`).

## Interface text

- No string a person reads is written in a `.tsx` file. Every text goes through `t("key")`, and the key exists
  in the partials of all ten languages in `frontend/src/i18n/locales/partials/<lang>/`: `en`, `ru`, `de`, `es`,
  `fr`, `ja`, `ko`, `pt-BR`, `tr`, `zh`. The translations are real translations, never a copy of the English.
- The server's own messages are Fluent keys in `crates/vs-server/locales/{en,ru}/server.ftl`, written in the
  language the window reports.
- Dates, sizes, durations and prices are formatted with the window's language (`Intl`), not a fixed locale.

## Build and check

```bash
cargo build --workspace
cargo test -p vs-server -p vs-providers     # the server's gate, must pass
cargo clippy -p vs-server --all-targets      # clean
cd frontend && npm ci
npm run check                                # lint, types, feature boundaries
npm run check:unused-exports                 # no new unused exports
npx vitest run                               # the window's tests
```

- Stop a running `vs-server.exe` before rebuilding it: Windows keeps the `.exe` locked.
- Run the server alone with `VIDEOSOS_ROOT=<folder>` and `VIDEOSOS_PORT=<port>`; the window's dev server
  (`npm run dev`, port 5196) proxies `/api`, `/mcp`, `/v1` and `/health` to it.
- The release is built by `scripts/build-release.ps1` (Windows), `scripts/build-linux-docker.sh` (Linux in
  Docker) and `.github/workflows/release-unix.yml` (macOS).

## Changelog

- A change a person can see is written to `CHANGELOG.md` in the same commit, in the Unreleased section:
  `### Added`, `### Changed` or `### Fixed`, each item starting with a bold phrase. Internal work (refactors,
  tests, tooling) is not listed.
- A release bumps the version in `desktop/src-tauri/tauri.conf.json` and the workspace `Cargo.toml`, dates the
  changelog section and adds a `frontend/src/features/studio/data/news.json` entry.

## Do not commit

- API keys, proxy credentials and signing keys, in any file.
- Downloaded programs (`data/tools`), projects, generations, caches and test media.
- Local agent notes and handoff files.
