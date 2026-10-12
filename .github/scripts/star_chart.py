#!/usr/bin/env python3
"""Render this repo's star history to SVG (dark+light). Zero deps, stdlib only.

Uses the Actions GITHUB_TOKEN via `gh api` env or GITHUB_TOKEN + urllib.
"""

import json
import os
import urllib.request
from datetime import datetime, timezone

REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
OUT_DIR = "docs"


def fetch_stars() -> list[datetime]:
    dates, page = [], 1
    while True:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/stargazers?per_page=100&page={page}",
            headers={"Accept": "application/vnd.github.star+json",
                     "Authorization": f"Bearer {TOKEN}",
                     "X-GitHub-Api-Version": "2022-11-28"})
        with urllib.request.urlopen(req) as r:
            batch = json.load(r)
        if not batch:
            break
        dates += [datetime.fromisoformat(s["starred_at"].replace("Z", "+00:00"))
                  for s in batch if s.get("starred_at")]
        if len(batch) < 100 or page >= 400:
            break
        page += 1
    return sorted(dates)


def render(dates: list[datetime], theme: str) -> str:
    w, h, pl, pr, pt, pb = 800, 420, 64, 24, 48, 56
    fg, grid, line = (("#e6edf3", "#30363d", "#4f8ff7") if theme == "dark"
                      else ("#1f2328", "#d1d9e0", "#0969da"))
    bg = "#0d1117" if theme == "dark" else "#ffffff"
    now = datetime.now(timezone.utc)
    if not dates:
        dates = [now]
    t0, t1 = dates[0], now
    span = max((t1 - t0).total_seconds(), 1)
    n = len(dates)
    ymax = max(n, 1)
    px = lambda t: pl + (w - pl - pr) * (t - t0).total_seconds() / span
    py = lambda v: h - pb - (h - pt - pb) * v / ymax
    pts = [(px(t0), py(0))] + [(px(d), py(i + 1)) for i, d in enumerate(dates)]
    pts.append((px(t1), py(n)))
    path = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    # сетка: 4 горизонтали + подписи
    rows = []
    for i in range(5):
        v = round(ymax * i / 4)
        y = py(v)
        rows.append(f'<line x1="{pl}" y1="{y:.1f}" x2="{w-pr}" y2="{y:.1f}" stroke="{grid}" stroke-width="1"/>'
                    f'<text x="{pl-10}" y="{y+4:.1f}" fill="{fg}" font-size="13" text-anchor="end">{v}</text>')
    # 4 подписи дат
    labels = []
    for i in range(4):
        t = t0 + (t1 - t0) * i / 3
        labels.append(f'<text x="{px(t):.1f}" y="{h-pb+24}" fill="{fg}" font-size="13" text-anchor="middle">{t.strftime("%b %d, %Y")}</text>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Segoe UI, sans-serif">
<rect width="{w}" height="{h}" fill="{bg}" rx="8"/>
<text x="{pl}" y="30" fill="{fg}" font-size="17" font-weight="700">★ Star History — {REPO}</text>
<text x="{w-pr}" y="30" fill="{fg}" font-size="14" text-anchor="end">{n} stars · updated {now.strftime("%Y-%m-%d")}</text>
{"".join(rows)}
<path d="{path}" fill="none" stroke="{line}" stroke-width="2.5" stroke-linejoin="round"/>
<circle cx="{px(t1):.1f}" cy="{py(n):.1f}" r="4" fill="{line}"/>
{"".join(labels)}
</svg>'''


def main() -> None:
    dates = fetch_stars()
    os.makedirs(OUT_DIR, exist_ok=True)
    for theme in ("dark", "light"):
        with open(f"{OUT_DIR}/stars-{theme}.svg", "w", encoding="utf-8") as f:
            f.write(render(dates, theme))
    print(f"rendered {len(dates)} stars")


if __name__ == "__main__":
    main()
