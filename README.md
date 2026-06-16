# Glass Designer

A browser-based, semi-3D design tool for **glass railings and shower/enclosures**.
Start from a **blank canvas**, drop in glass panels, set each one's size / finish /
holes, move and rotate them into place, price the job from your own rates, and
export a render + cut list to send a client.

No accounts, no server. It's a static PWA (like a website you can "install"),
runs on **laptop and iPhone**, and works offline after the first load.

---

## Use it locally

```bash
cd glass-railing-designer
python3 devserver.py 8780
# open http://127.0.0.1:8780
```

`devserver.py` just adds no-cache headers + correct MIME types. Any static
server works (`python3 -m http.server` is fine too).

## Deploy (GitHub Pages)

Push this folder to a GitHub repo. `.github/workflows/pages.yml` publishes the
repo root on every push to `main` — no build step. Enable Pages →
*Build and deployment* → *GitHub Actions*. It'll live at
`https://<you>.github.io/<repo>/`.

---

## How it works

- **Blank canvas.** *File ▸ New* opens an empty scene. Add panels with **＋ Panel**,
  **Inline run** (3 in a row, e.g. a railing), or **90° corner** (e.g. a shower
  return).
- **Every panel is independent:** width, height, thickness, glass finish, drilled
  holes, ground position (X/Z), rotation, and a **lock** to freeze its position.
- **Select + manipulate.** Click a panel (in the 3D view, the panel list, or the
  plan). A gizmo appears — **Move** drags it on the ground, **Rotate** spins it
  about vertical. **Snap** quantises to 1″ / 15°. Or type exact numbers in the
  panel card; the 3D view updates **in real time**.
- **Two views, one toggle.** *Iso* is a locked technical isometric; *3D* is a free
  orbit/zoom camera. Both run on the same scene.
- **Finishes:** Standard Clear, Sapphire (low-iron), Acid Etched, Tinted Gray,
  Tinted Bronze — each tints the glass differently and carries its own $/ft² rate.
- **Pricing:** per-finish $/ft², $/drilled-hole, optional tempering $/ft², and a
  job markup %. Per-panel and job totals update live.
- **Deliverables:** *File ▸ Export render* (PNG/JPEG, clean — grid/gizmo hidden),
  *Print / PDF quote* (render + plan + cut-list table + totals; use the browser's
  "Save as PDF"), and *Backup (.json)* / *Restore* to move a design between
  devices.
- **Projects** are saved automatically in the browser (per device). *File ▸ Open*
  lists them.

## Tech

- Plain HTML/CSS/ES modules — **no build step**.
- [three.js](https://threejs.org) via CDN (import map) for the 3D scene,
  `TransformControls` for the move/rotate gizmo, `CSS2DRenderer` for labels.
- Service worker caches the shell + three.js for offline use. On `localhost` the
  worker bypasses cache so edits show on reload.

## Project layout

```
index.html              app shell + import map + viewport toolbar
css/styles.css          all styles
js/
  app.js                controller: render pipeline + event wiring
  state.js              project model (flat panel list) + persistence
  glassTypes.js         finish catalogue (colour, opacity, default rate)
  geometry.js           panel footprint math (shared by 3D + plan)
  pricing.js            cost + cut-list math, ft/in formatting
  scene3d.js            three.js viewport: reconciling renderer + gizmo + cameras
  planView.js           top-down SVG plan (editor thumbnail + report)
  ui.js                 controls panel HTML builders
  exporter.js           image download + printable quote/cut-list
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline shell + CDN cache)
icons/                  PWA icons (+ dependency-free generator)
devserver.py            local dev server
```

## Roadmap ideas

- Drag panels directly in the top-down plan (often easier than the 3D gizmo).
- Hardware library (standoffs, clamps, hinges, posts) with per-item costs.
- More finishes / patterns, thickness-driven pricing tiers, DXF export.
- Snap panels edge-to-edge automatically when building runs and corners.
