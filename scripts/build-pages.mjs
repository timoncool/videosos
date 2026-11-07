// Renders the project page into docs/index.html (English) and docs/<lang>.html, and docs/sitemap.xml, as the
// author's studios render theirs. Every page is plain HTML in its own language, with the program and its
// questions described for search engines and AI answers (schema.org JSON-LD), so readers without JavaScript,
// crawlers and assistants all see the same page.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDER, SHOT_LANG, STRINGS } from '../docs/site/strings.mjs';
import { FAMILY, STUDIO } from '../docs/site/studio.mjs';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const css = readFileSync(join(docs, 'site', 'page.css'), 'utf8');
const { name: NAME, repo: REPO, site: SITE } = STUDIO;
const SHOT_SIZE = [1600, 900];

const escape = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const file = (lang) => (lang === 'en' ? 'index.html' : `${lang}.html`);
const pageUrl = (lang) => `${SITE}${lang === 'en' ? '' : file(lang)}`;
const shot = (lang, name) => `screenshots/${name}-${SHOT_LANG[lang]}.webp`;
/** The part of a screenshot a tile shows: the panel at work, legible at a tile's size. */
const tileShot = (lang, name) => `screenshots/${name}-${SHOT_LANG[lang]}-tile.webp`;
const TILE_SIZE = { canvas: [1030, 410], storyboard: [960, 844], blocking: [960, 844], graphics: [960, 844] };
const starsBadge = (alt) => `<img class="stars" src="https://img.shields.io/github/stars/${REPO.replace('https://github.com/', '')}?style=flat&amp;label=%E2%98%85&amp;color=3f3f46" alt="${alt}" height="20" />`;

/** The first sentence of a text: the one line a tile or the hero has room for. */
function firstSentence(text) {
  const cjk = text.match(/^(.+?[。！？])/);
  const latin = text.match(/^(.+?[.!?])(\s|$)/);
  const cut = [cjk?.[1], latin?.[1]].filter(Boolean).sort((a, b) => a.length - b.length)[0];
  return cut ?? text;
}

function page(lang) {
  const s = STRINGS[lang];
  const w = s.words;
  for (const key of Object.keys(STRINGS.en)) {
    if (!(key in s)) throw new Error(`[ERROR] ${lang} is missing "${key}"`);
  }
  for (const key of ['features', 'shots', 'steps', 'faq']) {
    if (s[key].length !== STRINGS.en[key].length) throw new Error(`[ERROR] ${lang} has ${s[key].length} ${key}, English has ${STRINGS.en[key].length}`);
  }
  const caption = (name) => {
    const found = s.shots.find(([id]) => id === name);
    if (!found) throw new Error(`[ERROR] no screenshot ${name} in ${lang}`);
    return found[1];
  };
  const [width, height] = SHOT_SIZE;

  const alternates = [
    ...ORDER.map((code) => `<link rel="alternate" hreflang="${code}" href="${pageUrl(code)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl('en')}" />`,
  ].join('\n');
  const family = FAMILY
    .map(([id, label, url]) => `    <a href="${id === STUDIO.id ? file(lang) : url}"${id === STUDIO.id ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('\n');
  const nav = ORDER
    .map((code) => `      <a href="${file(code)}" hreflang="${code}"${code === lang ? ' aria-current="page"' : ''}>${escape(STRINGS[code].label)}</a>`)
    .join('\n');

  const download = `<a class="btn primary" href="${REPO}/releases/latest">${escape(s.ctaDownload)}<small data-release>v${STUDIO.version}</small></a>`;

  const tiles = STUDIO.bento.map(({ feature, shot: name }) => {
    const [title, body] = s.features[feature];
    return `      <article class="tile">
        <h3>${escape(title)}</h3>
        <figure class="shot"><img src="${tileShot(lang, name)}" data-full="${shot(lang, name)}" alt="${escape(caption(name))}" loading="lazy" width="${TILE_SIZE[name][0]}" height="${TILE_SIZE[name][1]}" /></figure>
        <p>${escape(firstSentence(body))}</p>
      </article>`;
  }).join('\n');
  const inTiles = new Set(STUDIO.bento.map(({ feature }) => feature));
  const cards = s.features
    .map(([title, body], index) => (inTiles.has(index) ? '' : `      <article class="card"><h3>${escape(title)}</h3><p>${escape(body)}</p></article>`))
    .filter(Boolean)
    .join('\n');

  // a step's text was written to follow its title after a dash; in a card it starts a sentence
  const capital = (text) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
  const steps = s.steps
    .map(([title, body], index) => `      <li><b><span class="num">${index + 1}</span>${escape(title)}</b><span>${escape(capital(body))}</span></li>`)
    .join('\n');

  // Questions and answers: shown as they are, and handed to search engines and AI answers as FAQPage.
  const agentAnswer = s.features[STUDIO.faq.agent][1];
  const faq = [
    ...s.faq.map(([q, a]) => ({ q, text: [a], html: `<p>${escape(a)}</p>` })),
    { q: w.qAgent, text: [agentAnswer], html: `<p>${escape(agentAnswer)}</p><pre>claude mcp add --transport http videosos http://127.0.0.1:8796/mcp</pre>` },
    { q: w.qBuilt, text: [s.archSub], html: `<p>${escape(s.archSub)}</p><pre>${escape(STUDIO.arch)}</pre>` },
  ];

  const author = { '@type': 'Person', '@id': 'https://github.com/timoncool#person', name: 'Nerual Dreming', url: 'https://github.com/timoncool',
    sameAs: ['https://github.com/timoncool', 'https://t.me/nerual_dreming', 'https://artgeneration.me'] };
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication', '@id': `${SITE}#app`, name: NAME, url: pageUrl(lang), inLanguage: lang,
        description: s.description, applicationCategory: 'MultimediaApplication', applicationSubCategory: 'AI video generation and editing',
        operatingSystem: 'Windows 10, Windows 11, Linux, macOS', softwareVersion: STUDIO.version,
        downloadUrl: `${REPO}/releases/latest`, isAccessibleForFree: true, license: 'https://opensource.org/licenses/MIT',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: `${SITE}og-${lang}.jpg`, screenshot: `${SITE}${shot(lang, STUDIO.hero)}`,
        codeRepository: REPO, sameAs: [REPO], author: { '@id': author['@id'] }, dateModified: STUDIO.updated,
      },
      author,
      { '@type': 'FAQPage', inLanguage: lang, mainEntity: faq.map(({ q, text }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: text.join(' ') } })) },
    ],
  };

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(s.title)}</title>
<meta name="description" content="${escape(s.description)}" />
<link rel="canonical" href="${pageUrl(lang)}" />
${alternates}
<link rel="icon" type="image/png" href="logo.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${NAME}" />
<meta property="og:title" content="${escape(s.title)}" />
<meta property="og:description" content="${escape(s.description)}" />
<meta property="og:url" content="${pageUrl(lang)}" />
<meta property="og:locale" content="${lang}" />
<meta property="og:image" content="${SITE}og-${lang}.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escape(s.heroTitle)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE}og-${lang}.jpg" />
<link rel="preload" as="image" href="${shot(lang, STUDIO.hero)}" fetchpriority="high" />
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
${css.trimEnd()}
</style>
</head>
<body>
<header>
  <div class="utility"><div class="wrap utility-bar">
    <nav class="family" aria-label="Programs">
${family}
    </nav>
    <nav class="langs" aria-label="Language">
${nav}
    </nav>
  </div></div>
  <div class="wrap bar">
    <img class="mark" src="logo.png" alt="" width="30" height="30" />
    <div class="name">${NAME}</div>
    <a class="head-github" href="${REPO}">GitHub${starsBadge(escape(w.stars))}</a>
    <a class="head-download" href="${REPO}/releases/latest">${escape(w.download)}</a>
  </div>
</header>

<main class="wrap">
  <section class="hero">
    <h1>${escape(s.heroTitle)}</h1>
    <p class="lead">${escape(s.heroLead)}</p>
    <div class="cta">
      ${download}
      <a class="btn" href="${REPO}">${escape(w.starCta)}${starsBadge(escape(w.stars))}</a>
    </div>
    <p class="note">${escape(s.ctaNote)}</p>
    <figure class="hero-shot"><img src="${shot(lang, STUDIO.hero)}" alt="${escape(caption(STUDIO.hero))}" width="${width}" height="${height}" fetchpriority="high" /></figure>
  </section>

  <section id="features">
    <h2>${escape(s.featuresTitle)}</h2>
    <p class="sub">${escape(s.featuresSub)}</p>
    <div class="bento">
${tiles}
    </div>
    <div class="cards">
${cards}
    </div>
  </section>

  <section id="screenshots">
    <h2>${escape(s.shotsTitle)}</h2>
    <p class="sub">${escape(s.shotsSub)}</p>
    <div class="gallery">
${s.shots.map(([name, text]) => `      <figure><img src="${shot(lang, name)}" alt="${escape(text)}" loading="lazy" width="${width}" height="${height}" /><figcaption>${escape(text)}</figcaption></figure>`).join('\n')}
    </div>
  </section>

  <section id="start">
    <h2>${escape(s.startTitle)}</h2>
    <ol class="steps">
${steps}
    </ol>
    <div class="cta">${download}</div>
  </section>

  <section id="faq">
    <h2>${escape(w.faqTitle)}</h2>
${faq.map(({ q, html }) => `    <details><summary>${escape(q)}</summary><div class="answer">${html}</div></details>`).join('\n')}
  </section>

  <section id="author">
    <h2>${escape(s.authorTitle)}</h2>
    <p class="sub">${escape(s.authorSub)}</p>
    <div class="pills">
      <a class="pill" href="https://github.com/timoncool">GitHub · @timoncool</a>
      <a class="pill" href="https://t.me/nerual_dreming">Telegram · @nerual_dreming</a>
      <a class="pill" href="https://t.me/neuroport">Telegram · @neuroport</a>
      <a class="pill" href="https://artgeneration.me">ArtGeneration.me</a>
      <a class="pill" href="${REPO}/blob/main/DONATE.md">${escape(s.ctaDonate)}</a>
    </div>
  </section>

  <footer>
    <p>${escape(s.footerLicense)}</p>
    <p><a href="${REPO}/blob/main/CHANGELOG.md">${escape(s.footerChanges)}</a> · <a href="${REPO}/issues">${escape(s.footerIssues)}</a> · ${escape(w.updated)} <time datetime="${STUDIO.updated}">${STUDIO.updated}</time></p>
  </footer>
</main>

<div class="viewer" id="viewer" aria-hidden="true">
  <button type="button" aria-label="Close">×</button>
  <img id="viewer-image" alt="" />
</div>
<script>
const viewer = document.getElementById('viewer');
const viewerImage = document.getElementById('viewer-image');
const closeViewer = () => { viewer.classList.remove('open'); viewer.setAttribute('aria-hidden', 'true'); };
document.addEventListener('click', (event) => {
  const image = event.target.closest('.hero-shot img, .tile img, .gallery img');
  if (image) {
    viewerImage.src = image.dataset.full || image.src;
    viewerImage.alt = image.alt;
    viewer.classList.add('open');
    viewer.setAttribute('aria-hidden', 'false');
    return;
  }
  if (event.target.closest('#viewer')) closeViewer();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeViewer(); });
// the download buttons name the latest release as GitHub has it, so a new release needs no new page
fetch('https://api.github.com/repos/${REPO.replace('https://github.com/', '')}/releases/latest')
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error('GitHub answered ' + response.status))))
  .then((release) => {
    document.querySelectorAll('[data-release]').forEach((element) => { element.textContent = release.tag_name; });
  })
  .catch((error) => console.warn('Latest release not read; the page shows the one it was built with:', error));
</script>
</body>
</html>
`;
}

for (const lang of ORDER) {
  if (!STRINGS[lang]) throw new Error(`[ERROR] no text for ${lang}`);
  writeFileSync(join(docs, file(lang)), page(lang), 'utf8');
  console.log(`[OK] docs/${file(lang)}`);
}

// The sitemap names every language of the page and ties them together, as the pages do.
const links = [...ORDER.map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${pageUrl(code)}"/>`),
  `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl('en')}"/>`].join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${ORDER.map((code) => `  <url>
    <loc>${pageUrl(code)}</loc>
    <lastmod>${STUDIO.updated}</lastmod>
${links}
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(join(docs, 'sitemap.xml'), sitemap, 'utf8');
console.log('[OK] docs/sitemap.xml');
