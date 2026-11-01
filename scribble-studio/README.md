# Scribble Studio

A browser tool that turns typed text into hand-drawn, "boiling" scribble lettering. You can save it as a transparent PNG or as a looping video.

It's plain HTML, CSS and JS with no build step and no backend, and everything renders on your device.

## Run it

```bash
cd scribble-studio
python3 -m http.server 8000
```

Then open http://localhost:8000. You can also double-click `index.html`, but uploading fonts and copying to the clipboard work better over http.

## What it does today

| Area | Features |
|---|---|
| Text | Multi-line text (Shift+Enter), letter spacing, line height, left/center/right alignment |
| Fonts | 13 open-source handwritten Google Fonts, plus **upload your own handwriting font** (.ttf/.otf/.woff). Uploaded fonts stay on your device |
| Look | Thickness (thin/regular/bold/heavy), styles (fill / outline / drop-shadow / crayon grain), colour swatches + hex |
| Hand-drawn feel | **Roughness** (edges that look drawn with a marker), **wobble** (each letter gets its own small rotation, scale and offset), **reshuffle** (a new random variation) |
| Animation | **Line boil** (4 frames cycled at slow/med/fast), the classic stop-motion hand-drawn wiggle |
| Export | PNG at 1×/2×/4×, **transparent WebM** or MP4, SVG wrapper, copy PNG to the clipboard, ⌘/Ctrl+S shortcut |
| Workflow | Settings are remembered across visits, named presets, and a **share link** that stores the whole style in the URL |

### How the effect works (`app.js`)

1. Each glyph is drawn with a seeded random transform (wobble).
2. Thickness: a same-colour stroke makes letters thicker, and a `destination-out` stroke makes them thinner.
3. Every pixel is shifted by two layers of seeded value noise (roughness), which gives marker-like edges.
4. Optional crayon grain punches holes in the alpha channel.
5. Steps 1–4 run again with different seeds to make the boil frames.

## Making it a Mac app

The web version runs as-is. To get a native `.app`:

- **Tauri (recommended):** small (~5 MB) and uses the system WebKit. Run `npm create tauri-app`, point `frontendDist` at this folder, then `tauri build`. Note that Safari/WebKit records **MP4 but not WebM**, so in the Mac app you'd add native export through AVFoundation or bundle `ffmpeg` to get ProRes 4444 with alpha.
- **Electron:** bigger (~150 MB), but it's Chromium, so transparent WebM works the same as in Chrome.
- **SwiftUI rewrite:** best for a Mac App Store product. Core Text for glyphs, Core Image for the displacement, AVAssetWriter for ProRes 4444 / HEVC-with-alpha.

## Roadmap: ideas that would beat the original

**For video editors (the core audience)**
- **ProRes 4444 / HEVC-with-alpha export**, which Premiere, Final Cut and DaVinci accept as transparent footage. WebM alpha doesn't import everywhere.
- **PNG sequence (.zip)** and **animated GIF / APNG / Lottie** export.
- **Write-on animation**: letters draw themselves stroke by stroke, with adjustable speed and easing.
- **Per-letter animation presets**: bounce, pop-in, typewriter, jitter-in.
- Set the **loop length and frame count** (2–12 boil frames) and the export frame rate (24/25/30/60).
- **Final Cut / Premiere plugin** or a Motion template that wraps the renderer.

**More creative control**
- **Turn your own handwriting into a font**: photograph a filled-in template sheet and auto-vectorise the glyphs.
- Several alternate shapes per letter so repeated letters ("ll", "ss") never look identical.
- Gradient and texture fills (paper, chalk, spray paint, highlighter), plus a stroke/outline colour separate from the fill.
- Doodle extras: underlines, circles, arrows, stars, scribble highlights, all boiling with the text.
- Text on a path or arc, plus rotation and skew of the whole block.
- A canvas/layers mode with several text blocks, stickers and positioning, exported at fixed sizes (9:16, 1:1, 16:9).
- Other modes to go with the disabled tabs: **SFX** (comic onomatopoeia with bursts), **VHS** (chromatic aberration, scanlines, tracking noise), **Color** (palette generator).

**Productivity**
- Batch mode: paste a list or upload a CSV of captions and export one file per line (useful for subtitles and lower thirds).
- SRT import to make animated hand-drawn subtitles.
- A brand kit: locked fonts, colours and presets shared across a team.
- Command palette and full keyboard control.

**Business (if you sell it)**
- Free tier: PNG at 1× with a watermark. Pro: video and alpha export, 4×, custom fonts, batch.
- Accounts with cloud-synced presets, and a gallery of community styles.
- REST API / Figma plugin / Canva app that use the same renderer.
