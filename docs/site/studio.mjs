// What the project page says about VideoSOS beyond its text: the release it offers, the features its tiles show
// (places in each language's features list, with the screenshot each shows), and the answers it points to.
export const STUDIO = {
  id: 'videosos',
  name: 'VideoSOS',
  repo: 'https://github.com/timoncool/videosos',
  site: 'https://timoncool.github.io/videosos/',
  version: '2.1.0',
  updated: '2026-10-14',
  hero: 'editor',
  bento: [
    { feature: 3, shot: 'storyboard' },
    { feature: 4, shot: 'canvas' },
    { feature: 5, shot: 'blocking' },
    { feature: 6, shot: 'graphics' },
  ],
  faq: { agent: 10 },
  arch: "React window (FreeCut fork) ─┐\n                             ├─ VideoSOS.exe   (Tauri shell + Rust/axum server inside)\nRust axum server ────────────┘        │\n                                      ├─ OpenRouter · fal · Runware   (your keys)\n                                      └─ MCP  http://127.0.0.1:8796/mcp",
};

// The author's other programs, as tabs over the page.
export const FAMILY = [
  ['videosos', 'VideoSOS', 'https://timoncool.github.io/videosos/'],
  ['dub', 'Dub Studio', 'https://timoncool.github.io/dub-studio/'],
  ['yue2', 'YuE2 Studio', 'https://timoncool.github.io/YuE2-Studio/'],
  ['minimax', 'MiniMax Music3 Studio', 'https://timoncool.github.io/MiniMax-Music3-Studio/'],
  ['ace', 'ACE-Step Studio', 'https://timoncool.github.io/ACE-Step-Studio/'],
];
