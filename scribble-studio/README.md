# Scribble Studio

A browser tool that turns typed text into hand-drawn, "boiling" scribble lettering, either with built-in fonts or **your own letters drawn in Procreate**. It exports files you can drop straight into Premiere, Resolve or After Effects.

It's plain HTML, CSS and JS with no build step and no backend, and everything renders on your device.

## Run it

```bash
cd scribble-studio
python3 server.py
```

Then open http://localhost:8000. `server.py` is the **local helper**. It serves the app and adds the pro exports (ProRes 4444 / HEVC alpha) using ffmpeg. Install ffmpeg once with `brew install ffmpeg`. It only listens on your own computer, and exports are also saved to `~/Movies/Scribble Studio`.

`python3 -m http.server 8000` still works too. You just won't get the ProRes/HEVC cards or the Adobe panel import.

### As a Mac app

```bash
bash mac/make-app.sh
```

This builds **~/Applications/Scribble Studio.app**. Double-click it (the first time, right-click → Open, because it isn't notarised). It starts the helper in the background and opens the app in its own Chrome/Edge window, or your default browser. Logs go to `~/Library/Logs/scribble-studio.log`.

### Inside Premiere Pro / After Effects (panel)

```bash
bash adobe-panel/install.sh
```

Quit and reopen Premiere Pro or After Effects → **Window → Extensions → Scribble Studio**.

- The full app runs in the panel. **It starts the helper by itself**, so there's no Terminal needed. `install.sh` records where `server.py` lives; re-run it if you move the folder.
- Every export is **imported into your project**: a "Scribble Studio" bin in Premiere, a "Scribble Studio" folder in After Effects.
- With **place on timeline** ticked (the checkbox in the panel's top bar):
  - **Premiere**: the clip goes onto the active sequence **at the playhead**, on the lowest video track above V1 that's free at that moment. So it lands over your footage, never on it.
  - **After Effects**: it's added as a layer to the active comp, starting at the current time.
- PNG sequences come in as one image-sequence clip. ProRes 4444 is the best choice: a single file with transparency.
- The status bar shows what happened ("✓ placed on the timeline at the playhead"), or why it couldn't (no project open, no active sequence…).

It's a CEP panel, which Premiere Pro and After Effects 2020–2025 load. It isn't signed by Adobe, so the installer turns on `PlayerDebugMode`, which unsigned panels need.

## What it does today

| Area | Features |
|---|---|
| Text | Multi-line text (Shift+Enter), letter spacing, line height, alignment |
| Fonts | 13 open-source handwritten Google Fonts, **upload a .ttf/.otf** (remembered on this device), and **build your own font from PNG drawings** (below) |
| Look | Thickness (thin/regular/bold/heavy), fill / outline / drop-shadow / crayon grain, colour swatches + hex |
| Hand-drawn feel | **Roughness** (edges that look drawn with a marker), **wobble** (each letter gets its own small rotation, scale and offset), **🎲 reshuffle** (a new random variation) |
| Animation | **Line boil**: 2–12 redrawn frames at 6 / 8 / 12 drawings per second (on 4s, 3s or 2s at 24 fps). The loop length readout and the **seamless** option round exports to whole loops |
| Editor exports | **ProRes 4444** and **HEVC with alpha** (via the helper), PNG sequence with alpha, MP4 on black / white / green, WebM with alpha, **GIF**, **APNG**, **Lottie**, PNG still. You can set the frame (fit text, **9:16** Reels/Shorts/TikTok, **4:5** IG feed, **3:4** IG grid, 1:1, 16:9) in HD or 4K, the fps (24/25/30/60) and the length |
| Workflow | Settings are remembered, named presets, a style link, ⌘S saves a PNG |

## Build your own font from Procreate drawings

Click **✏️ build my font**. A keyboard pops up (the default name is "Ila Signature"):

1. Click **⬇ Procreate template**. It's a 1000×1000 guide with baseline, x-height and cap lines.
2. In Procreate, draw one letter per export on the same canvas size and hide the guide layer. Then **Share → PNG**. A white background is fine too, because white is removed automatically.
3. Upload in any of these ways:
   - **Click a key** and choose the PNG. Pick several files to give that letter **alternate drawings**.
   - **Drag PNGs onto a key**.
   - Select a key and press **⌘V** to paste a letter you copied in Procreate (iPad → Mac Universal Clipboard).
   - **Bulk upload** a folder of files named after the letter:
     `a.png`, `upper_a.png` (macOS can't hold both `a.png` and `A.png`), `a-2.png` (2nd drawing of a),
     `question.png`, `comma.png`, `7.png` …
4. Tune the **baseline**, **letter size** and **letter gap** while watching the live test line, then click **use this font**.

More details:
- **Boil swaps alternate drawings**: when a letter has 2 or more drawings, each boil frame uses a different one, like real redrawn animation. Doubled letters ("ll") never use the same drawing twice in a row.
- **Keep my drawn colours** (off by default): turn it on for multi-colour or textured letters. When it's off, letters are recoloured with the colour picker.
- Roughness, wobble, thickness, outline, shadow and crayon all work on drawn letters too.
- Letters you haven't drawn yet fall back to a handwritten font, so you can test as you go.
- **⬇ export pack** saves the whole font as one `.scribblefont` file for backup or another computer. **import pack** loads it back. Fonts are stored in the browser (IndexedDB) and never uploaded anywhere.

## Animate in & out

Pick an **in** and an **out** animation, each with its own duration (**0.2 s – 5 s**):

| Effect | What it does |
|---|---|
| Fade | Opacity |
| Blur | Comes into focus / dissolves into blur |
| Glow | Blooms with a glow of the text colour, then settles |
| Grow | Scales from nothing (try the *Back out* curve for a pop) |
| Slide up / down / left / right | Moves in from the opposite side, leaves in that direction |
| Flicker | Random on/off like a dodgy neon sign, settling on |
| Motion blur | Whooshes in sideways with real motion-blur streaks |
| Typewriter | Letters pop on one at a time (use *letter* + some stagger) |
| Write on (pen strokes) | **Draws each letter stroke by stroke along its pen path.** Each glyph is thinned to a skeleton, the strokes are traced from the top-left, and the ink is revealed in that order. It works on your drawn PNG fonts too |
| Write on (wipe) | Reveals left to right as if being written |

- **Animate by** the whole text, line by line, word by word or letter by letter. **Line delay** (0–3 s) adds per-line timing: each line starts after the one above.
- **Motion presets**: 10 built-in looks (Pop up, Handwritten, Signature, Neon sign, Soft focus, Whoosh, Typewriter, Bouncy grow, Line by line, Stop-motion drop). Use **+ save** to keep your own. **copy code / paste code** shares a look as a short `SSM1.…` code, and ⬇ / ⬆ export and import all your presets as a `.scribblemotion` file.
- **Stagger** sets the delay between units (0–0.5 s). **Order** goes first→last, last→first, from the centre outwards, or random.
- **Motion curves**: separate easing for in and out. The presets are Linear, Ease, Sine, Quad, Cubic, Quart, Expo, Circ, Back (overshoot / anticipate), Elastic, Bounce, and Stepped (stop-motion). You can also **drag the yellow handles** on the graph to make a custom `cubic-bezier`. The value is shown under the graph so you can copy it into CSS or match it in After Effects. A pink dot runs along the curve so you can feel the timing.
- **Timeline**: play / pause (space bar) and scrub. Green is the in section, pink is the out section. **On 2s** holds every pose for 2 frames for that hand-made feel.
- The clip length comes from the **length** slider. It's stretched automatically if in + stagger + out need more time.
- All exports (MP4s, PNG sequence, WebM) include the animation, and it combines with the boil, roughness and every frame size.

Under the hood every letter is pre-rendered as a sprite with roughness and the other looks applied (`buildDrawing` in `app.js`). `anim.js` then only moves, fades, blurs or glows sprites per frame, which keeps playback smooth.

## Short-form frames (Reels, Shorts, TikTok, IG feed)

| Frame | Size (HD / 4K) | For |
|---|---|---|
| **9:16** | 1080×1920 / 2160×3840 | Instagram Reels, YouTube Shorts, TikTok, Stories |
| **4:5** | 1080×1350 / 2160×2700 | Instagram & Facebook feed (portrait) |
| **3:4** | 1080×1440 / 2160×2880 | Instagram profile grid, Threads |
| **1:1** | 1080×1080 / 2160×2160 | Square posts |
| **16:9** | 1920×1080 / 3840×2160 | YouTube, regular edits |
| **fit text** | hugs the lettering | A free-floating overlay you position in your editor |

- **Safe zones**: the preview shades the areas the apps cover. On 9:16 that's the header, the caption / @handle / audio bar and the like / comment / share column. It uses the strictest of Reels, Shorts and TikTok, so text placed inside the dashed box is safe on all three. The guides are never exported.
- **Position** (top / center / lower) and **text width** place the lettering inside the safe box.
- Lettering is re-rendered at the exact size it lands in the frame, so 4K exports stay sharp instead of being upscaled.
- File names include the ratio, for example `my-title-9x16-screen.mp4`.

## Exports for Premiere Pro / DaVinci Resolve / After Effects

| Export | Use it like this |
|---|---|
| **ProRes 4444 (.mov)** | One file with real transparency. Drop it on a track in Premiere, Final Cut, Resolve or AE. Needs the helper and ffmpeg |
| **HEVC with alpha (.mov)** | Much smaller transparent file for Final Cut and Apple devices. Needs the helper and ffmpeg **on a Mac** (Apple VideoToolbox) |
| **PNG sequence (.zip)** | Real transparency, so just put it on the track above. Premiere: Import → tick *Image Sequence*. AE: tick *PNG Sequence*. Resolve reads the folder as one clip. A how-to file is in the zip |
| **MP4 · black** | Blend mode **Screen** (or Add / Linear Dodge). Best with light or bright text. Works everywhere, including Final Cut |
| **MP4 · white** | Blend mode **Multiply**. Best with dark text, like ink on paper |
| **MP4 · green** | Ultra Key / Keylight / 3D Keyer |
| **WebM · alpha** | Transparent video for Resolve / AE. Chrome only; Premiere can't read it |
| **GIF** | Loops forever, max 720 px. Uses the preview background (none = transparent, with hard 1-bit edges) |
| **APNG** | Animated PNG with smooth full alpha, max 1080 px. Works on the web, Discord, Telegram and in Keynote |
| **Lottie (.json)** | For LottieFiles, websites and iOS/Android apps. Frames are embedded PNGs, and held drawings are merged |

Where the blend mode setting is:
- Premiere: Effect Controls → Opacity → Blend Mode.
- AE: Modes column (F4).
- Resolve: Inspector → Composite Mode.
- FCP: Inspector → Compositing.

The MP4s are encoded frame by frame with WebCodecs and [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, in `vendor/`), so they're frame-accurate H.264. That works in Chrome, Edge and Safari 16.4+.

### How the effect works (`app.js`)

1. Each glyph (font text or your PNG) is drawn with a seeded random transform (wobble).
2. Thickness: text is stroked or eroded, and PNG glyphs are dilated or eroded (`glyphfonts.js`).
3. Every pixel is shifted by two layers of seeded value noise (roughness), which gives marker-like edges.
4. Optional crayon grain.
5. Steps 1–4 run again with different seeds to make the boil frames.

## Making it a Mac app

The web version runs as-is. To get a native `.app`:

- **Tauri (recommended):** small (~5 MB) and uses the system WebKit. Run `npm create tauri-app`, point `frontendDist` at this folder, then `tauri build`. Note that Safari/WebKit records **MP4 but not WebM**, so in the Mac app you'd add native export through AVFoundation or bundle `ffmpeg` to get ProRes 4444 with alpha.
- **Electron:** bigger (~150 MB), but it's Chromium, so transparent WebM works the same as in Chrome.
- **SwiftUI rewrite:** best for a Mac App Store product. Core Text for glyphs, Core Image for the displacement, AVAssetWriter for ProRes 4444 / HEVC-with-alpha.

## Roadmap: ideas that would beat the original

**For video editors (the core audience)**
- A native **FxPlug plugin for Final Cut / Motion** (needs Xcode and Swift; for now, export ProRes 4444 and drop it in).
- Lottie with real per-letter vector keyframes instead of embedded frames.

**More creative control**
- Export a drawn font as a real **.otf** (trace the PNGs into vectors) so it works in Word, Figma and Premiere's text tool.
- Scan one photographed sheet with every letter instead of separate PNGs.
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
