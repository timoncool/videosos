# Product

## Register

product

## Users

Experienced video editors. They come from Premiere Pro and DaVinci Resolve and
expect those workflows: keyboard-driven, frame-accurate, dense panels they read
at a glance. Their context is a focused editing session, often hours long, eyes
on the preview and timeline, hands on shortcuts. They want professional power
without an install, a subscription, or cloud uploads. The headline draw is that
projects and media stay local on disk while editing, analysis, transcription,
AI generation, and export all run in the browser.

## Product Purpose

FreeCut is a browser-based, local-first, multi-track video editor. It exists to
give serious editors a real NLE that runs entirely in the browser, with a
workspace folder on their own disk as the source of truth (projects, media
metadata, thumbnails, waveforms, transcripts, scene cuts, caches all as plain
files). Success is an editor who would otherwise open Premiere choosing FreeCut
for a real cut, and never noticing the browser, because playback is
frame-accurate, scrubbing is responsive, and the tools they reach for by muscle
memory are all there.

## Brand Personality

Precise and professional. Three words: **precise, confident, calm.** The UI is a
serious instrument, not a consumer toy. Voice in labels and copy is direct and
technical, the language editors already use (ripple, rolling, slip, slide, mark
in/out, source-time). No exclamation, no hand-holding, no whimsy. The interface
projects expert confidence by being legible, predictable, and fast.

## Anti-references

- **Consumer-cute editors** (CapCut, iMovie): playful mascots, rounded candy
  buttons, emoji, gamified flourishes. FreeCut is a pro tool, not a toy.
- **Flashy SaaS dashboards**: gradient heroes, glassmorphism, big-number metric
  cards, marketing-grade decoration inside the working UI.
- **Cramped legacy NLE chrome**: dense to the point of noise, beveled gray
  toolbars, illegible 10px labels. Density here must stay clean and readable.
- **Bare-bones open-source utility look**: default browser controls, unstyled
  forms, no considered visual hierarchy.

## Design Principles

1. **The footage is the hero.** Chrome stays quiet and recedes; the preview and
   the editor's content carry the color and attention. The UI earns pixels only
   when it helps the cut.
2. **Density without noise.** High information density is a feature for this
   user, but every panel must stay scannable, aligned, and legible. Clean is not
   the enemy of dense.
3. **Frame-accurate and responsive, always.** Perceived precision is part of the
   brand. Interactions (scrub, zoom, playback, edits) must feel instant and
   exact; sluggishness or imprecision reads as amateur.
4. **Respect muscle memory.** Match the conventions pro editors already carry
   (Remotion-style timing, NLE edit tools, keyboard-first operation). Surprise is
   a cost, not a delight.
5. **Expert confidence, not hand-holding.** Speak the editor's language plainly.
   Trust the user; don't over-explain or decorate.

## Accessibility & Inclusion

- **WCAG AA contrast.** Body text holds >=4.5:1 against its panel background;
  large/bold text >=3:1. The current `--muted-foreground` (oklch 0.6) on dark
  panels is borderline and should be verified and bumped toward ink where it
  fails. Placeholder text held to the same 4.5:1.
- Always-dark theme is intentional for long sessions and color-critical work
  (scopes, grading); contrast work happens within the dark ramp, not by adding a
  light mode.
- Honor `prefers-reduced-motion` for panel transitions, scrub overlays, and
  reveals as the system grows (not yet captured as a hard requirement, revisit
  with the user).
