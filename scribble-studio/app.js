/* Scribble Studio — hand-drawn animated text generator.
 *
 * Pipeline for every frame:
 *   1. layout + draw each glyph with a tiny random transform ("wobble").
 *      Glyphs are either font text, or your own PNG drawings (see glyphfonts.js).
 *   2. adjust stroke thickness (dilate / erode)
 *   3. displace pixels with seeded value-noise ("roughness")  -> marker-like edges
 *   4. optional crayon grain
 * Several frames are generated with different seeds and cycled at N drawings/sec
 * to create the classic hand-drawn "line boil" animation.
 */
(() => {
  "use strict";

  const FONTS = [
    "Gochi Hand", "Caveat", "Permanent Marker", "Rock Salt", "Indie Flower",
    "Shadows Into Light", "Gaegu", "Patrick Hand", "Nanum Pen Script",
    "Reenie Beanie", "Covered By Your Grace", "Schoolbell", "Kalam",
  ];
  const FALLBACK_FONT = "Gochi Hand"; // used for characters your drawn font doesn't have yet
  const SWATCHES = ["#3b4fd8", "#111111", "#ffffff", "#e5484d", "#f5a524", "#12a150"];
  const BOIL_FRAMES = 4;
  const THICKNESS = { thin: -0.016, regular: 0, bold: 0.022, heavy: 0.042 };
  const BG = { transparent: null, black: "#000000", white: "#ffffff" };

  const DEFAULTS = {
    text: "filmkid",
    font: "Gochi Hand",
    size: 128,
    spacing: 0,
    lineHeight: 1.1,
    thickness: "regular",
    style: "fill",
    color: "#3b4fd8",
    shadowColor: "#ff5a7a",
    shadowOffset: 6,
    align: "center",
    roughness: 3,
    wobble: 2,
    boil: 8,
    bgMode: "transparent",
    bgColor: "#ffffff",
    scale: 2,
    frame: "fit",
    place: "center",
    fill: 70,
    res: 1,
    guides: true,
    fps: 24,
    seconds: 5,
    seed: 1,
    // in / out animation
    animIn: "none",
    animOut: "none",
    inDur: 0.6,
    outDur: 0.6,
    animBy: "letter",
    stagger: 0.05,
    order: "forward",
    easeIn: "cubicOut",
    easeInBez: [0.33, 1, 0.68, 1],
    easeOut: "cubicIn",
    easeOutBez: [0.32, 0, 0.67, 0],
    steps: false,
  };

  const state = { ...DEFAULTS };
  const $ = (id) => document.getElementById(id);
  const preview = $("preview");
  const pctx = preview.getContext("2d");
  const GF = window.GlyphFonts;

  // ---------- seeded randomness & noise ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(i, j, seed) {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 982451653);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  /** Grid of random values; sampling it with smooth interpolation gives value-noise. */
  function noiseGrid(w, h, cell, seed) {
    const gw = Math.ceil(w / cell) + 2;
    const gh = Math.ceil(h / cell) + 2;
    const g = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) g[j * gw + i] = hash2(i, j, seed) * 2 - 1;
    return { g, gw, cell };
  }

  function sample(n, x, y) {
    const fx = x / n.cell, fy = y / n.cell;
    const i = fx | 0, j = fy | 0;
    let tx = fx - i, ty = fy - j;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const r0 = j * n.gw + i, r1 = r0 + n.gw;
    const a = n.g[r0] + (n.g[r0 + 1] - n.g[r0]) * tx;
    const b = n.g[r1] + (n.g[r1 + 1] - n.g[r1]) * tx;
    return a + (b - a) * ty;
  }

  // ---------- fonts ----------
  const glyphId = (font) => (font.startsWith("glyph:") ? font.slice(6) : null);
  const fontString = (family, px) => `${px}px "${family}"`;

  async function ensureFont(S = state) {
    const fam = glyphId(S.font) ? FALLBACK_FONT : S.font;
    try { await document.fonts.load(fontString(fam, S.size), S.text || "a"); } catch (_) { /* ignore */ }
  }

  // ---------- layout ----------
  /**
   * Returns lines of { chars, items: [{ x (left), adv, kind, … }], width } in pixels.
   * Text fonts use prefix widths so the font's kerning is kept.
   */
  function layout(S, px, measure) {
    const lines = S.text.replace(/\r/g, "").split("\n");
    const spacing = (S.spacing / 100) * px;
    const gid = glyphId(S.font);
    const gfont = gid && GF.get(gid);

    return lines.map((line) => {
      const chars = [...line];
      const items = [];
      if (!gfont) {
        measure.font = fontString(gid ? FALLBACK_FONT : S.font, px);
        let prefix = "";
        chars.forEach((ch, k) => {
          const x = measure.measureText(prefix).width + k * spacing;
          prefix += ch;
          items.push({ x, adv: measure.measureText(ch).width, kind: "text", font: measure.font });
        });
        const width = chars.length ? measure.measureText(line).width + (chars.length - 1) * spacing : 0;
        return { chars, items, width };
      }
      const rec = gfont.rec;
      const imgH = px * 1.25 * rec.scale;
      let x = 0;
      chars.forEach((ch) => {
        let item;
        const variants = ch === " " ? null : GF.lookup(gid, ch);
        if (ch === " ") item = { adv: px * 0.3 * rec.scale, kind: "space" };
        else if (variants) {
          const maxW = Math.max(...variants.map((v) => (v.w * imgH) / v.h));
          item = { adv: maxW + rec.gap * px, kind: "img", variants, imgH, rec };
        } else {
          measure.font = fontString(FALLBACK_FONT, px);
          item = { adv: measure.measureText(ch).width + rec.gap * px, kind: "text", font: measure.font };
        }
        item.x = x;
        items.push(item);
        x += item.adv + spacing;
      });
      return { chars, items, width: Math.max(0, x - spacing) };
    });
  }

  // ---------- rendering ----------
  /**
   * Builds one "drawing": every letter is rendered as its own sprite with wobble, thickness,
   * shadow, roughness and crayon baked in. Sprites remember their resting position so the
   * animation system (anim.js) can move them independently.
   * margin: extra room around the text, in multiples of the font size, for moving letters.
   */
  function buildDrawing(scale, frameSeed, over, margin = 0) {
    const S = over ? { ...state, ...over } : state;
    const px = S.size * scale;
    const measure = document.createElement("canvas").getContext("2d");
    const laid = layout(S, px, measure);
    const maxW = Math.max(1, ...laid.map((l) => l.width));

    const rough = S.roughness;
    const lineH = px * S.lineHeight;
    const shadowOff = S.style === "shadow" ? S.shadowOffset * scale : 0;
    const thick = THICKNESS[S.thickness] * px;
    const pad = Math.ceil(px * 0.45 + rough * px * 0.02 + shadowOff + Math.abs(thick) * 2 + margin * px);
    const W = Math.ceil(maxW + pad * 2 + shadowOff);
    const H = Math.ceil(lineH * (laid.length - 1) + px * 1.25 + pad * 2 + shadowOff);

    const rand = mulberry32(S.seed * 7919 + frameSeed * 104729);
    const wob = S.wobble;
    const outline = S.style === "outline";
    const outlineW = Math.max(1.5 * scale, px * 0.03 + Math.max(0, thick));

    // Decide each glyph's position, jitter and drawing once.
    const glyphs = [];
    let gi = 0, word = 0, inWord = false;
    laid.forEach((line, li) => {
      let x0 = pad;
      if (S.align === "center") x0 = pad + (maxW - line.width) / 2;
      else if (S.align === "right") x0 = pad + (maxW - line.width);
      const baseY = pad + px * 0.95 + li * lineH;
      let prev = null;
      line.items.forEach((it, k) => {
        const ch = line.chars[k];
        if (it.kind === "space" || ch === " ") {
          prev = null;
          if (inWord) { word++; inWord = false; }
          return;
        }
        const g = {
          ch, it, word, line: li,
          x: x0 + it.x + it.adv / 2 + (rand() * 2 - 1) * wob * px * 0.004,
          y: baseY + (rand() * 2 - 1) * wob * px * 0.008,
          rot: (rand() * 2 - 1) * wob * 0.035, // radians
          sc: 1 + (rand() * 2 - 1) * wob * 0.012,
        };
        if (it.kind === "img") {
          const n = it.variants.length;
          const cycle = it.rec.cycle ? frameSeed : 0;
          g.vi = Math.min(n - 1, Math.floor(hash2(gi, cycle, S.seed) * n));
          // never repeat the same drawing for doubled letters ("ll", "ss")
          if (prev && prev.ch === ch && prev.vi === g.vi && n > 1) g.vi = (g.vi + 1) % n;
        }
        glyphs.push(g);
        prev = g;
        inWord = true;
        gi++;
      });
      if (inWord) { word++; inWord = false; }
    });

    const sprites = glyphs.map((g, idx) => {
      let left, right, above, below;
      if (g.it.kind === "img") {
        const v = g.it.variants[g.vi];
        const vw = (v.w * g.it.imgH) / v.h;
        left = right = vw / 2;
        above = g.it.imgH * g.it.rec.baseline;
        below = g.it.imgH * (1 - g.it.rec.baseline);
      } else {
        left = right = g.it.adv / 2;
        above = px * 1.0;
        below = px * 0.38;
      }
      const ext = Math.max(left, right, above, below);
      const rotRoom = ext * (Math.abs(Math.sin(g.rot)) + Math.abs(g.sc - 1));
      const m = Math.ceil(px * 0.06 + rough * px * 0.022 + Math.abs(thick) * 2 + (outline ? outlineW : 0) + rotRoom + 2);
      const L = Math.ceil(left * g.sc + m), A = Math.ceil(above * g.sc + m);
      const sw = Math.ceil(L + right * g.sc + m + shadowOff), sh = Math.ceil(A + below * g.sc + m + shadowOff);
      const c = document.createElement("canvas");
      c.width = Math.max(1, sw); c.height = Math.max(1, sh);
      const ctx = c.getContext("2d");
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const layer = (color, off, isShadow) => {
        ctx.save();
        ctx.translate(L + off, A + off);
        ctx.rotate(g.rot);
        ctx.scale(g.sc, g.sc);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        if (g.it.kind === "img") {
          const v = g.it.variants[g.vi];
          const imgH = g.it.imgH;
          const r = GF.render(v, imgH, {
            color, thick, outline, outlineW: outlineW * 0.6,
            keepColors: g.it.rec.keepColors, forceTint: isShadow,
          });
          const vw = (v.w * imgH) / v.h;
          ctx.drawImage(r.canvas, -vw / 2 - r.pad, -imgH * g.it.rec.baseline - r.pad);
        } else {
          ctx.font = g.it.font;
          const x = -g.it.adv / 2;
          if (outline) { ctx.lineWidth = outlineW; ctx.strokeText(g.ch, x, 0); }
          else {
            if (thick > 0) { ctx.lineWidth = thick * 2; ctx.strokeText(g.ch, x, 0); }
            ctx.fillText(g.ch, x, 0);
            if (thick < 0) { // thin: erode the edges
              ctx.globalCompositeOperation = "destination-out";
              ctx.lineWidth = -thick * 2;
              ctx.strokeStyle = "#000";
              ctx.strokeText(g.ch, x, 0);
            }
          }
        }
        ctx.restore();
      };
      if (S.style === "shadow") layer(S.shadowColor, shadowOff, true);
      layer(S.color, 0, false);

      if (rough > 0) displace(ctx, c.width, c.height, px, rough, S.seed * 31 + frameSeed * 1013 + idx * 7919);
      if (S.style === "crayon") crayon(ctx, c.width, c.height, px, S.seed * 17 + frameSeed * 7 + idx * 131);
      return {
        c, x: g.x - L, y: g.y - A, ax: g.x, ay: g.y,
        ix0: g.x - left, ix1: g.x + right, idx, word: g.word, line: g.line,
      };
    });
    return { W, H, px, sprites };
  }

  /** Flattens a drawing into one canvas, every letter at rest. */
  function composeStatic(d) {
    const c = document.createElement("canvas");
    c.width = d.W; c.height = d.H;
    const ctx = c.getContext("2d");
    for (const sp of d.sprites) ctx.drawImage(sp.c, sp.x, sp.y);
    return c;
  }

  /** Renders one still frame at a pixel scale. `over` temporarily overrides state (font builder). */
  function renderFrame(scale, frameSeed, over) {
    return composeStatic(buildDrawing(scale, frameSeed, over, 0));
  }

  /** Marker-edge effect: shifts each pixel by two octaves of smooth noise. */
  function displace(ctx, W, H, px, rough, seed) {
    const src = ctx.getImageData(0, 0, W, H);
    const out = ctx.createImageData(W, H);
    const s = src.data, o = out.data;
    const lowCell = Math.max(6, px * 0.22);
    const hiCell = Math.max(2, px * 0.035);
    const lowAmp = rough * px * 0.0045;
    const hiAmp = rough * px * 0.0028;
    const nLx = noiseGrid(W, H, lowCell, seed + 1);
    const nLy = noiseGrid(W, H, lowCell, seed + 2);
    const nHx = noiseGrid(W, H, hiCell, seed + 3);
    const nHy = noiseGrid(W, H, hiCell, seed + 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = (x + sample(nLx, x, y) * lowAmp + sample(nHx, x, y) * hiAmp + 0.5) | 0;
        const sy = (y + sample(nLy, x, y) * lowAmp + sample(nHy, x, y) * hiAmp + 0.5) | 0;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const si = (sy * W + sx) << 2;
        if (s[si + 3] === 0) continue;
        const oi = (y * W + x) << 2;
        o[oi] = s[si]; o[oi + 1] = s[si + 1]; o[oi + 2] = s[si + 2]; o[oi + 3] = s[si + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  /** Crayon / pencil grain: knocks holes in the alpha channel with streaky noise. */
  function crayon(ctx, W, H, px, seed) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const SX = 0.5, SY = 1.6; // stretch the noise so the grain streaks like wax on paper
    const streak = noiseGrid(W * SX, H * SY, Math.max(2, px * 0.02), seed + 9);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = ((y * W + x) << 2) + 3;
        if (d[i] === 0) continue;
        const grain = hash2(x, y, seed);
        const st = sample(streak, x * SX, y * SY);
        if (grain < 0.16 + st * 0.18) d[i] = 0;
        else d[i] = Math.min(d[i], 170 + grain * 85);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- preview: frame cache & animation ----------
  let previewFrames = [];   // flattened stills (one per boil drawing)
  let previewDrawings = []; // sprite drawings, used for animation
  let renderToken = 0;
  const animCanvas = document.createElement("canvas");
  let playing = true, playStart = performance.now(), scrubT = 0;

  const animActive = () => state.animIn !== "none" || state.animOut !== "none";
  function animSettings() {
    return {
      in: state.animIn, out: state.animOut, inDur: state.inDur, outDur: state.outDur,
      stagger: state.stagger, by: state.animBy, order: state.order, seconds: state.seconds,
      easeInFn: window.Anim.easeFn(state.easeIn, state.easeInBez),
      easeOutFn: window.Anim.easeFn(state.easeOut, state.easeOutBez),
      steps: state.steps, seed: state.seed, color: state.color, fps: state.fps,
    };
  }
  const animMargin = () => (animActive() ? window.Anim.marginFor(animSettings()) : 0);
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function rebuild() {
    const token = ++renderToken;
    await ensureFont();
    if (token !== renderToken) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const count = state.boil > 0 ? BOIL_FRAMES : 1;
    const margin = animMargin();
    const frames = [], drawings = [];
    for (let f = 0; f < count; f++) {
      const d = buildDrawing(dpr, f, null, margin);
      drawings.push(d);
      frames.push(composeStatic(d));
      await tick(); // keep slider dragging responsive
      if (token !== renderToken) return;
    }
    previewFrames = frames;
    previewDrawings = drawings;
    previewCB = null;
    layoutPreview();
  }

  const bgFor = (mode) => (mode === "solid" ? state.bgColor : BG[mode] ?? null);
  const frameSpec = () => ({ frame: state.frame, res: state.res, place: state.place, fill: state.fill });
  const isFixed = () => state.frame !== "fit";
  let previewCB = null;

  /** Sizes the preview canvas: hugging the text, or a scaled-down mock of the chosen frame. */
  function layoutPreview() {
    if (!previewFrames.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!isFixed()) {
      const f = previewFrames[0];
      preview.width = f.width;
      preview.height = f.height;
      preview.style.width = f.width / dpr + "px";
    } else {
      const [W, H] = window.Exporter.frameSize(frameSpec(), previewFrames[0]);
      const maxW = Math.min(1000, document.getElementById("stage").clientWidth || 1000);
      let cssH = Math.min(560, window.innerHeight * 0.5);
      let cssW = (cssH * W) / H;
      if (cssW > maxW) { cssW = maxW; cssH = (cssW * H) / W; }
      preview.width = Math.round(cssW * dpr);
      preview.height = Math.round(cssH * dpr);
      preview.style.width = cssW + "px";
      if (!previewCB) previewCB = window.Exporter.contentBox(previewFrames);
    }
    preview.style.height = "auto";
    preview.classList.toggle("framed", isFixed());
    drawPreview(performance.now(), true);
  }

  let lastIdx = -1;
  function drawPreview(t, force) {
    if (!previewFrames.length) return;
    const idx = state.boil > 0 ? Math.floor((t / 1000) * state.boil) % previewFrames.length : 0;
    let d;
    if (animActive() && previewDrawings[idx]) {
      const A = animSettings();
      const T = window.Anim.timing(A, window.Anim.unitsOf(previewDrawings[idx], A.by).n);
      if (playing) scrubT = ((t - playStart) / 1000) % T.total;
      else scrubT = Math.min(scrubT, T.total);
      d = window.Anim.compose(previewDrawings[idx], scrubT, A, animCanvas);
      timelineUI(scrubT, T);
    } else {
      if (idx === lastIdx && !force) return;
      d = previewFrames[idx];
    }
    lastIdx = idx;
    pctx.clearRect(0, 0, preview.width, preview.height);
    const bg = bgFor(state.bgMode);
    if (bg) { pctx.fillStyle = bg; pctx.fillRect(0, 0, preview.width, preview.height); }
    if (!isFixed()) { pctx.drawImage(d, 0, 0); return; }

    const E = window.Exporter;
    const spec = frameSpec();
    const [W, H] = E.frameSize(spec, d);
    const q = preview.width / W;
    const p = E.placement(spec, W, H, d, previewCB || E.contentBox([d]));
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(d, p.x * q, p.y * q, d.width * p.s * q, d.height * p.s * q);
    if (state.guides) drawGuides(spec, W, H, q);
  }

  /** Safe-zone overlay (preview only — never exported). */
  function drawGuides(spec, W, H, q) {
    const sb = window.Exporter.safeBox(spec, W, H);
    const x = sb.x * q, y = sb.y * q, w = sb.w * q, h = sb.h * q;
    const PW = preview.width, PH = preview.height;
    pctx.save();
    pctx.fillStyle = "rgba(229, 72, 77, 0.10)";
    pctx.fillRect(0, 0, PW, y);
    pctx.fillRect(0, y + h, PW, PH - y - h);
    pctx.fillRect(0, y, x, h);
    pctx.fillRect(x + w, y, PW - x - w, h);
    pctx.strokeStyle = "rgba(229, 72, 77, 0.8)";
    pctx.lineWidth = Math.max(1, PW / 400);
    pctx.setLineDash([6 * (PW / 400), 5 * (PW / 400)]);
    pctx.strokeRect(x, y, w, h);
    pctx.setLineDash([]);
    if (spec.frame === "9:16") {
      const fs = Math.max(9, PW / 26);
      pctx.font = `600 ${fs}px system-ui, sans-serif`;
      pctx.fillStyle = "rgba(190, 40, 50, 0.85)";
      pctx.textAlign = "center";
      pctx.fillText("caption · @handle · audio", x + w / 2, y + h + (PH - y - h) / 2);
      pctx.fillText("header", PW / 2, y / 2 + fs / 3);
      pctx.save();
      pctx.translate(x + w + (PW - x - w) / 2, y + h * 0.75);
      pctx.rotate(-Math.PI / 2);
      pctx.fillText("♥ 💬 ↗ buttons", 0, fs / 3);
      pctx.restore();
    }
    pctx.restore();
  }

  function loop(t) {
    drawPreview(t, false);
    if (curveIn && !$("animDetails").hidden) { curveIn.draw(); curveOut.draw(); }
    requestAnimationFrame(loop);
  }

  let debounceT;
  function schedule() {
    clearTimeout(debounceT);
    debounceT = setTimeout(rebuild, 40);
    persist();
  }

  // ---------- export ----------
  function slug() {
    return (state.text.trim().split("\n")[0] || "scribble")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "scribble";
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /**
   * Renders the boil drawings (sprites + flattened stills).
   * For fixed frames the scale is chosen so the ink lands 1:1 in the frame (sharp).
   */
  async function exportDrawings() {
    await ensureFont();
    let scale = state.scale;
    if (isFixed()) {
      const probe = renderFrame(1, 0);
      const k = window.Exporter.idealScale(frameSpec(), window.Exporter.contentBox([probe]));
      scale = Math.max(0.25, Math.min(16, k));
    }
    const count = state.boil > 0 ? BOIL_FRAMES : 1;
    const margin = animMargin();
    const drawings = [], stills = [];
    for (let f = 0; f < count; f++) {
      const d = buildDrawing(scale, f, null, margin);
      drawings.push(d);
      stills.push(composeStatic(d));
      await tick();
    }
    return { drawings, stills };
  }

  const toBlob = (c, type = "image/png") => new Promise((r) => c.toBlob(r, type));

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function progress(p, label) {
    const box = $("progress");
    if (p == null) { box.hidden = true; return; }
    box.hidden = false;
    box.firstElementChild.style.width = Math.round(p * 100) + "%";
    box.lastElementChild.textContent = label || Math.round(p * 100) + "%";
  }

  const busy = (on) => document.querySelectorAll(".export-card").forEach((b) => (b.disabled = on));

  async function runExport(kind) {
    const E = window.Exporter;
    const tag = isFixed() ? "-" + state.frame.replace(":", "x") : "";
    const base = slug() + tag;
    const fps = state.fps;
    const lum = luminance(state.color);
    const gid = glyphId(state.font);
    const keeps = gid && GF.get(gid) && GF.get(gid).rec.keepColors;
    busy(true);
    progress(0, "drawing frames…");
    try {
      const { drawings, stills } = await exportDrawings();
      const spec = frameSpec();
      const cb = isFixed() ? E.contentBox(stills) : null;
      const A = animActive() ? animSettings() : null;
      const units = A ? window.Anim.unitsOf(drawings[0], A.by).n : 1;
      const seconds = A ? window.Anim.timing(A, units).total : state.seconds;
      const total = Math.max(1, Math.round(seconds * fps));
      const drawingAt = (i) => (state.boil > 0 ? Math.floor((i * state.boil) / fps) % stills.length : 0);
      const scratchC = document.createElement("canvas");
      const provider = (bg) => {
        const work = document.createElement("canvas");
        return (i) => {
          const di = drawingAt(i);
          const src = A ? window.Anim.compose(drawings[di], i / fps, A, scratchC) : stills[di];
          return E.composeOne(src, spec, bg, cb, work);
        };
      };
      const opts = { fps, total, base, key: (i) => (A ? i : drawingAt(i)) };
      let res;
      if (kind === "png") {
        res = { blob: await toBlob(E.composeOne(stills[0], spec, bgFor(state.bgMode), cb)), ext: "png" };
      } else if (kind === "png-seq") {
        res = await E.pngSequence(provider(null), { ...opts, onProgress: (p) => progress(p, "packing PNGs…") });
      } else if (kind === "webm") {
        progress(0.5, "recording in real time…");
        res = await E.webm(provider(null), opts);
      } else {
        const bg = { "mp4-black": "#000000", "mp4-white": "#ffffff", "mp4-green": "#00b140" }[kind];
        if (!keeps && kind === "mp4-black" && lum < 0.18) toast("Heads up: dark text vanishes with Screen. Pick a light colour, or use MP4 · white.");
        if (!keeps && kind === "mp4-white" && lum > 0.7) toast("Heads up: light text vanishes with Multiply. Pick a dark colour, or use MP4 · black.");
        res = await E.mp4(provider(bg), { ...opts, onProgress: (p) => progress(p, "encoding MP4…") });
      }
      const suffix = { png: "", "png-seq": "-alpha-seq", webm: "-alpha", "mp4-black": "-screen", "mp4-white": "-multiply", "mp4-green": "-greenscreen" }[kind];
      download(res.blob, `${base}${suffix}.${res.ext}`);
      const mb = (res.blob.size / 1048576).toFixed(1);
      toast(`Saved ${res.ext.toUpperCase()} (${mb} MB)` + (kind === "mp4-black" ? " → blend mode Screen" : kind === "mp4-white" ? " → blend mode Multiply" : ""));
    } catch (e) {
      console.error(e);
      toast("Export failed: " + e.message);
    } finally {
      busy(false);
      progress(null);
    }
  }

  async function copyPng() {
    try {
      const { stills } = await exportDrawings();
      const [c] = window.Exporter.compose(stills.slice(0, 1), "fit", bgFor(state.bgMode));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(c) })]);
      toast("PNG copied — paste it into Figma, Keynote, Premiere…");
    } catch (e) {
      toast("Clipboard not available in this browser — use PNG still instead");
    }
  }

  // ---------- persistence, presets, sharing ----------
  const STORE = "scribble-studio:v1";
  const PRESETS = "scribble-studio:presets:v1";
  const SHAREABLE = Object.keys(DEFAULTS);

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { /* private mode */ }
  }

  function pick(obj) {
    const out = {};
    for (const k of SHAREABLE) if (obj && k in obj && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
    return out;
  }

  function loadInitial() {
    try { Object.assign(state, pick(JSON.parse(localStorage.getItem(STORE) || "null"))); } catch (_) { /* ignore */ }
    if (location.hash.length > 1) {
      try { Object.assign(state, pick(JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1))))))); } catch (_) { /* bad link */ }
    }
    if (![0, 6, 8, 12].includes(state.boil)) state.boil = 8;
    const legacy = { "1080p": ["16:9", 1], "4k": ["16:9", 2], vertical: ["9:16", 1], square: ["1:1", 1] };
    if (legacy[state.frame]) [state.frame, state.res] = legacy[state.frame];
    if (!(state.frame in window.Exporter.FRAMES)) state.frame = "fit";
    const AN = window.Anim;
    if (!(state.animIn in AN.EFFECTS)) state.animIn = "none";
    if (!(state.animOut in AN.EFFECTS)) state.animOut = "none";
    if (!(state.easeIn in AN.EASES)) state.easeIn = DEFAULTS.easeIn;
    if (!(state.easeOut in AN.EASES)) state.easeOut = DEFAULTS.easeOut;
    const okBez = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && isFinite(v));
    if (!okBez(state.easeInBez)) state.easeInBez = DEFAULTS.easeInBez.slice();
    if (!okBez(state.easeOutBez)) state.easeOutBez = DEFAULTS.easeOutBez.slice();
    if (!(state.bgMode in BG) && state.bgMode !== "solid") state.bgMode = "transparent";
  }

  function validateFont() {
    const known = new Set([...FONTS, ...GF.list().map((f) => (f.kind === "ttf" ? f.name : "glyph:" + f.id))]);
    if (!known.has(state.font)) state.font = DEFAULTS.font;
  }

  async function shareLink() {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    const url = `${location.origin}${location.pathname}#${encoded}`;
    try { await navigator.clipboard.writeText(url); toast("Style link copied (drawn fonts stay on this device)"); }
    catch (_) { history.replaceState(null, "", "#" + encoded); toast("Link is in the address bar"); }
  }

  function getPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS) || "[]"); } catch (_) { return []; }
  }
  function setPresets(list) {
    try { localStorage.setItem(PRESETS, JSON.stringify(list)); } catch (_) { /* ignore */ }
    renderPresets();
  }
  function renderPresets() {
    const box = $("presetList");
    box.innerHTML = "";
    const list = getPresets();
    if (!list.length) {
      box.innerHTML = '<span style="opacity:.8">save a look to reuse it later</span>';
      return;
    }
    list.forEach((p, i) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.innerHTML = `<span></span><span class="x" title="Delete">×</span>`;
      b.firstChild.textContent = p.name;
      if (!glyphId(p.state.font || "")) b.style.fontFamily = `"${p.state.font}"`;
      b.onclick = (e) => {
        if (e.target.classList.contains("x")) {
          const l = getPresets(); l.splice(i, 1); setPresets(l); return;
        }
        Object.assign(state, pick(p.state), { text: state.text });
        validateFont();
        syncUI(); schedule();
      };
      box.appendChild(b);
    });
  }

  // ---------- UI ----------
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  function refreshFontOptions() {
    const sel = $("font");
    sel.innerHTML = "";
    const group = (label, items) => {
      if (!items.length) return;
      const g = document.createElement("optgroup");
      g.label = label;
      items.forEach(([value, name, family]) => {
        const o = document.createElement("option");
        o.value = value; o.textContent = name;
        if (family) o.style.fontFamily = `"${family}"`;
        g.appendChild(o);
      });
      sel.appendChild(g);
    };
    const mine = GF.list();
    group("✏️ my drawn fonts", mine.filter((f) => f.kind === "glyph").map((f) => ["glyph:" + f.id, f.name]));
    group("uploaded", mine.filter((f) => f.kind === "ttf").map((f) => [f.name, f.name, f.name]));
    group("built-in", FONTS.map((f) => [f, f, f]));
    sel.value = state.font;
  }

  const sliders = ["size", "spacing", "lineHeight", "roughness", "wobble", "seconds", "fill"];

  function syncUI() {
    const gid = glyphId(state.font);
    $("font").value = state.font;
    $("font").style.fontFamily = gid ? "" : `"${state.font}"`;
    $("editFont").hidden = !gid;
    $("text").value = state.text;
    $("text").style.fontFamily = gid ? "" : `"${state.font}", var(--ui-font)`;
    sliders.forEach((k) => { $(k).value = state[k]; $(k + "Val").textContent = state[k]; });
    $("color").value = state.color;
    $("colorHex").value = state.color.toUpperCase();
    $("shadowColor").value = state.shadowColor;
    $("shadowOffset").value = state.shadowOffset;
    $("bgColor").value = state.bgColor;
    $("shadowCtrl").hidden = state.style !== "shadow";
    $("frameOpts").hidden = !isFixed();
    $("detailCtrl").hidden = isFixed(); // fixed frames pick the sharpest scale automatically
    $("guides").checked = state.guides;
    // animation
    $("animIn").value = state.animIn;
    $("animOut").value = state.animOut;
    $("easeIn").value = state.easeIn;
    $("easeOut").value = state.easeOut;
    for (const k of ["inDur", "outDur", "stagger"]) { $(k).value = state[k]; $(k + "Val").textContent = state[k] + "s"; }
    $("steps").checked = state.steps;
    $("animDetails").hidden = !animActive();
    $("inDur").disabled = state.animIn === "none";
    $("outDur").disabled = state.animOut === "none";
    $("bezIn").textContent = bezLabel(state.easeIn, state.easeInBez);
    $("bezOut").textContent = bezLabel(state.easeOut, state.easeOutBez);
    document.querySelectorAll(".seg").forEach((seg) => {
      const key = seg.dataset.key;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(state[key])));
    });
  }

  function wire() {
    $("font").onchange = (e) => { state.font = e.target.value; syncUI(); schedule(); };

    $("fontUpload").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const rec = await GF.addTtf(file);
        state.font = rec.name;
        refreshFontOptions(); syncUI(); schedule();
        toast(`Loaded "${rec.name}" — saved on this device`);
      } catch (err) {
        toast("Couldn't read that font file");
      }
    };

    $("text").addEventListener("input", (e) => { state.text = e.target.value; schedule(); });
    $("text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) e.preventDefault(); // Shift+Enter = new line
    });

    sliders.forEach((k) => {
      $(k).addEventListener("input", (e) => {
        state[k] = parseFloat(e.target.value);
        $(k + "Val").textContent = state[k];
        if (k === "seconds") persist();
        else if (k === "fill") { persist(); drawPreview(performance.now(), true); }
        else schedule();
      });
    });

    const exportOnly = new Set(["scale", "fps"]);
    const layoutOnly = new Set(["frame", "place", "res"]);
    document.querySelectorAll(".seg").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const key = seg.dataset.key;
        const v = b.dataset.v;
        state[key] = typeof DEFAULTS[key] === "number" ? parseFloat(v) : v;
        syncUI();
        if (exportOnly.has(key)) persist();
        else if (layoutOnly.has(key)) { persist(); layoutPreview(); }
        else if (key === "animBy" || key === "order") { persist(); restartPlayback(); }
        else if (key === "bgMode") { persist(); drawPreview(performance.now(), true); }
        else schedule();
      });
    });

    const swatches = $("swatches");
    SWATCHES.forEach((hex) => {
      const b = document.createElement("button");
      b.style.background = hex; b.title = hex;
      b.onclick = () => { state.color = hex; syncUI(); schedule(); };
      swatches.appendChild(b);
    });
    $("color").addEventListener("input", (e) => { state.color = e.target.value; $("colorHex").value = state.color.toUpperCase(); schedule(); });
    $("colorHex").addEventListener("change", (e) => {
      let v = e.target.value.trim();
      if (!v.startsWith("#")) v = "#" + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) { state.color = v.toLowerCase(); syncUI(); schedule(); }
      else e.target.value = state.color.toUpperCase();
    });
    $("shadowColor").addEventListener("input", (e) => { state.shadowColor = e.target.value; schedule(); });
    $("shadowOffset").addEventListener("input", (e) => { state.shadowOffset = parseFloat(e.target.value); schedule(); });
    $("bgColor").addEventListener("input", (e) => {
      state.bgColor = e.target.value;
      state.bgMode = "solid";
      syncUI(); persist();
      drawPreview(performance.now(), true);
    });

    $("guides").addEventListener("change", (e) => { state.guides = e.target.checked; persist(); drawPreview(performance.now(), true); });
    window.addEventListener("resize", () => { clearTimeout(wire.rt); wire.rt = setTimeout(layoutPreview, 120); });

    document.querySelectorAll("[data-export]").forEach((b) => (b.onclick = () => runExport(b.dataset.export)));
    $("copyPng").onclick = copyPng;
    $("reseed").onclick = () => { state.seed = (Math.random() * 1e6) | 0; schedule(); };
    $("share").onclick = shareLink;
    $("savePreset").onclick = () => {
      const label = $("font").selectedOptions[0] ? $("font").selectedOptions[0].textContent : state.font;
      const name = prompt("Name this look:", `${label} ${state.style}`);
      if (!name) return;
      const list = getPresets();
      list.push({ name: name.slice(0, 40), state: { ...state } });
      setPresets(list);
    };

    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); runExport("png"); }
    });

    wireAnimation();

    $("openBuilder").onclick = () => Builder.open(glyphId(state.font));
    $("editFont").onclick = () => Builder.open(glyphId(state.font));
  }

  // ---------- animation UI ----------
  function bezLabel(name, bez) {
    const e = window.Anim.EASES[name];
    const b = name === "custom" ? bez : e && e[1];
    return b ? `cubic-bezier(${b.join(", ")})` : `${e ? e[0] : name} (not a bezier curve)`;
  }

  function restartPlayback() {
    playStart = performance.now();
    scrubT = 0;
    if (!playing) { playing = true; $("play").textContent = "❚❚"; }
  }

  let lastTL = "";
  function timelineUI(t, T) {
    if (!scrubbing) $("scrub").value = Math.round((t / T.total) * 1000);
    const label = `${t.toFixed(1)} / ${T.total.toFixed(1)}s`;
    if (label !== lastTL) { $("tlTime").textContent = label; lastTL = label; }
    $("tlIn").style.width = (T.inSpan / T.total) * 100 + "%";
    $("tlOut").style.width = (T.outSpan / T.total) * 100 + "%";
  }

  let scrubbing = false;
  let curveIn, curveOut;

  function wireAnimation() {
    const AN = window.Anim;
    for (const id of ["animIn", "animOut"]) {
      const sel = $(id);
      for (const [v, label] of Object.entries(AN.EFFECTS)) {
        const o = document.createElement("option");
        o.value = v; o.textContent = label;
        sel.appendChild(o);
      }
      sel.addEventListener("change", (e) => {
        state[id] = e.target.value;
        syncUI();
        schedule(); // canvas margin depends on the effect
        restartPlayback();
      });
    }
    for (const id of ["easeIn", "easeOut"]) {
      const sel = $(id);
      for (const [group, names] of AN.EASE_GROUPS) {
        const g = document.createElement("optgroup");
        g.label = group;
        for (const n of names) {
          const o = document.createElement("option");
          o.value = n; o.textContent = AN.EASES[n][0];
          g.appendChild(o);
        }
        sel.appendChild(g);
      }
      sel.addEventListener("change", (e) => {
        state[id] = e.target.value;
        syncUI(); persist(); restartPlayback();
        (id === "easeIn" ? curveIn : curveOut).restart();
      });
    }
    for (const k of ["inDur", "outDur", "stagger"]) {
      $(k).addEventListener("input", (e) => {
        state[k] = parseFloat(e.target.value);
        $(k + "Val").textContent = state[k] + "s";
        persist();
      });
      $(k).addEventListener("change", restartPlayback);
    }
    $("steps").addEventListener("change", (e) => { state.steps = e.target.checked; persist(); });

    $("play").onclick = () => {
      playing = !playing;
      if (playing) playStart = performance.now() - scrubT * 1000;
      $("play").textContent = playing ? "❚❚" : "▶";
    };
    const scrub = $("scrub");
    scrub.addEventListener("pointerdown", () => { scrubbing = true; playing = false; $("play").textContent = "▶"; });
    scrub.addEventListener("pointerup", () => (scrubbing = false));
    scrub.addEventListener("input", (e) => {
      playing = false;
      $("play").textContent = "▶";
      const d = previewDrawings[0];
      if (!d) return;
      const A = animSettings();
      const T = AN.timing(A, AN.unitsOf(d, A.by).n);
      scrubT = (parseFloat(e.target.value) / 1000) * T.total;
      drawPreview(performance.now(), true);
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && animActive() && !e.target.matches("input, textarea, select, button")) {
        e.preventDefault();
        $("play").click();
      }
    });

    const editor = (canvasId, nameKey, bezKey) =>
      AN.CurveEditor($(canvasId), () => ({ name: state[nameKey], bez: state[bezKey] }), (bez) => {
        state[nameKey] = "custom";
        state[bezKey] = bez;
        syncUI(); persist();
      });
    curveIn = editor("curveIn", "easeIn", "easeInBez");
    curveOut = editor("curveOut", "easeOut", "easeOutBez");
  }

  // ---------- font builder (keyboard of PNG letters) ----------
  const Builder = (() => {
    const ROWS = [
      ["`1234567890-=", "~!@#$%^&*()_+"],
      ["qwertyuiop[]\\", "QWERTYUIOP{}|"],
      ["asdfghjkl;'", "ASDFGHJKL:\""],
      ["zxcvbnm,./", "ZXCVBNM<>?"],
    ];
    const ALL = ROWS.flatMap((r) => [...r[0], ...r[1]]);
    const dlg = $("builder");
    let id = null;
    let createdNow = false;
    let shift = false;
    let selected = null;
    let pendingKey = null;
    const urls = new WeakMap();
    const thumb = (entry) => {
      if (!urls.has(entry)) urls.set(entry, URL.createObjectURL(entry.blob));
      return urls.get(entry);
    };

    const font = () => GF.get(id);

    async function open(existingId) {
      if (existingId && GF.get(existingId)) { id = existingId; createdNow = false; }
      else { id = await GF.create("Ila Signature"); createdNow = true; refreshFontOptions(); }
      const rec = font().rec;
      $("bName").value = rec.name;
      $("bBaseline").value = rec.baseline;
      $("bScale").value = rec.scale;
      $("bGap").value = rec.gap;
      $("bKeep").checked = rec.keepColors;
      $("bCycle").checked = rec.cycle;
      shift = false;
      selected = null;
      renderKeys();
      samplePreview();
      dlg.showModal();
    }

    function hasGlyphs() {
      const f = font();
      return !!f && Object.values(f.images).some((a) => a.length);
    }

    async function close() {
      if (createdNow && !hasGlyphs()) {
        await GF.remove(id);
        refreshFontOptions(); validateFont(); syncUI();
      }
      dlg.close();
    }

    function renderKeys() {
      const kb = $("kb");
      kb.innerHTML = "";
      const f = font();
      ROWS.forEach((row) => {
        const r = document.createElement("div");
        r.className = "kb-row";
        [...(shift ? row[1] : row[0])].forEach((ch) => {
          const k = document.createElement("button");
          k.className = "key";
          k.dataset.ch = ch;
          const arr = f.images[ch] || [];
          k.title = arr.length ? `${ch}: ${arr.length} drawing(s). Click to add more, × to clear` : `Upload "${ch}"`;
          if (arr.length) {
            k.classList.add("has");
            k.innerHTML = `<span class="lab"></span><img alt=""><span class="clr" title="Clear">×</span>${arr.length > 1 ? `<span class="n">${arr.length}</span>` : ""}`;
            k.querySelector("img").src = thumb(arr[0]);
          } else {
            k.innerHTML = `<span class="lab"></span><span class="ghost-ch"></span>`;
            k.querySelector(".ghost-ch").textContent = ch;
          }
          k.querySelector(".lab").textContent = ch;
          if (ch === selected) k.classList.add("sel");
          r.appendChild(k);
        });
        kb.appendChild(r);
      });
      const done = ALL.filter((ch) => (f.images[ch] || []).length).length;
      $("bCount").textContent = `${done} / ${ALL.length}`;
      $("bShift").setAttribute("aria-pressed", String(shift));
    }

    async function addTo(ch, files) {
      files = [...files].filter((f) => f && (f.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name || "")));
      if (!files.length) return;
      const key = $("kb").querySelector(`.key[data-ch="${CSS.escape(ch)}"]`);
      if (key) key.classList.add("busy");
      try {
        await GF.addGlyphs(id, ch, files);
      } catch (e) {
        toast(`Couldn't use that image for "${ch}": ${e.message}`);
      }
      selected = ch;
      renderKeys();
      changed();
    }

    function changed() {
      clearTimeout(changed.t);
      changed.t = setTimeout(() => {
        samplePreview();
        if (glyphId(state.font) === id) schedule();
      }, 60);
    }

    let sampleToken = 0;
    async function samplePreview() {
      const t = ++sampleToken;
      await ensureFont({ ...state, font: "glyph:" + id });
      if (t !== sampleToken || !font()) return;
      const c = $("bPreview");
      const frame = renderFrame(1, 0, {
        text: $("bSample").value || "Ila", font: "glyph:" + id, size: 72, align: "center",
        lineHeight: 1.1, style: state.style === "shadow" ? "fill" : state.style,
      });
      c.width = frame.width; c.height = frame.height;
      c.getContext("2d").drawImage(frame, 0, 0);
    }

    function saveRec() {
      clearTimeout(saveRec.t);
      saveRec.t = setTimeout(() => GF.save(id), 250);
      GF.clearCache();
      changed();
    }

    // events
    $("bClose").onclick = close;
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    $("bShift").onclick = () => { shift = !shift; renderKeys(); };

    $("kb").addEventListener("click", async (e) => {
      const k = e.target.closest(".key");
      if (!k) return;
      const ch = k.dataset.ch;
      if (e.target.classList.contains("clr")) {
        await GF.clearGlyph(id, ch);
        renderKeys(); changed();
        return;
      }
      selected = ch;
      renderKeys();
      pendingKey = ch;
      $("bKeyFile").click();
    });
    $("bKeyFile").onchange = (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (pendingKey && files.length) addTo(pendingKey, files);
    };

    $("kb").addEventListener("dragover", (e) => {
      const k = e.target.closest(".key");
      if (!k) return;
      e.preventDefault();
      $("kb").querySelectorAll(".drop").forEach((x) => x !== k && x.classList.remove("drop"));
      k.classList.add("drop");
    });
    $("kb").addEventListener("dragleave", (e) => { const k = e.target.closest(".key"); if (k) k.classList.remove("drop"); });
    $("kb").addEventListener("drop", (e) => {
      const k = e.target.closest(".key");
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      k.classList.remove("drop");
      addTo(k.dataset.ch, e.dataTransfer.files);
    });
    dlg.addEventListener("dragover", (e) => e.preventDefault());
    dlg.addEventListener("drop", (e) => { e.preventDefault(); bulk(e.dataTransfer.files); });

    // ⌘V a letter copied from Procreate (Universal Clipboard) onto the selected key
    document.addEventListener("paste", (e) => {
      if (!dlg.open || !selected) return;
      if (e.target.matches && e.target.matches("input")) return;
      const files = [...((e.clipboardData && e.clipboardData.items) || [])]
        .filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
      if (files.length) { e.preventDefault(); addTo(selected, files); }
    });

    // press a key on your keyboard to jump to it
    dlg.addEventListener("keydown", (e) => {
      if (e.target.matches("input") || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      if (!ALL.includes(e.key)) return;
      e.preventDefault();
      selected = e.key;
      shift = ROWS.some((r) => r[1].includes(e.key));
      renderKeys();
    });

    async function bulk(fileList) {
      const files = [...fileList];
      if (!files.length) return;
      const groups = new Map();
      const unknown = [];
      for (const f of files) {
        const ch = GF.parseName(f.name || "");
        if (ch && ch !== " ") {
          if (!groups.has(ch)) groups.set(ch, []);
          groups.get(ch).push(f);
        } else unknown.push(f.name);
      }
      if (!groups.size && selected) { await addTo(selected, files); return; }
      let n = 0;
      for (const [ch, fs] of groups) {
        try { await GF.addGlyphs(id, ch, fs); n += fs.length; } catch (e) { unknown.push(fs.map((f) => f.name).join(", ")); }
        $("bCount").textContent = `adding… ${n}`;
      }
      renderKeys(); changed();
      toast(`Added ${n} drawing(s) to ${groups.size} key(s)` +
        (unknown.length ? ` · couldn't match: ${unknown.slice(0, 4).join(", ")}${unknown.length > 4 ? "…" : ""}` : ""));
    }
    $("bBulk").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; bulk(f); };

    $("bName").addEventListener("input", (e) => { font().rec.name = e.target.value.slice(0, 40) || "Untitled"; saveRec(); refreshFontOptions(); syncUI(); });
    $("bBaseline").addEventListener("input", (e) => { font().rec.baseline = parseFloat(e.target.value); saveRec(); });
    $("bScale").addEventListener("input", (e) => { font().rec.scale = parseFloat(e.target.value); saveRec(); });
    $("bGap").addEventListener("input", (e) => { font().rec.gap = parseFloat(e.target.value); saveRec(); });
    $("bKeep").addEventListener("change", (e) => { font().rec.keepColors = e.target.checked; saveRec(); });
    $("bCycle").addEventListener("change", (e) => { font().rec.cycle = e.target.checked; saveRec(); });
    $("bSample").addEventListener("input", changed);

    $("bTemplate").onclick = () => {
      GF.template(font().rec.baseline).toBlob((b) => download(b, "glyph-template-1000x1000.png"));
      toast("Import it into Procreate — draw each letter, hide the guide layer, export PNG");
    };
    $("bExport").onclick = async () => {
      const blob = await GF.exportPack(id);
      download(blob, `${font().rec.name}.scribblefont`);
      toast("Font pack saved — import it on any device");
    };
    $("bImport").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        if (createdNow && !hasGlyphs()) await GF.remove(id);
        const newIdent = await GF.importPack(file);
        refreshFontOptions();
        dlg.close();
        await open(newIdent);
        toast(`Imported "${font().rec.name}"`);
      } catch (err) {
        toast("Couldn't import: " + err.message);
      }
    };
    $("bDelete").onclick = async () => {
      if (!confirm(`Delete "${font().rec.name}" and all its drawings from this device?`)) return;
      await GF.remove(id);
      dlg.close();
      refreshFontOptions(); validateFont(); syncUI(); schedule();
      toast("Font deleted");
    };
    $("bUse").onclick = () => {
      if (!hasGlyphs()) { toast("Upload at least one letter first"); return; }
      createdNow = false;
      state.font = "glyph:" + id;
      dlg.close();
      refreshFontOptions(); syncUI(); schedule();
    };

    return { open };
  })();

  // ---------- boot ----------
  loadInitial();
  refreshFontOptions();
  wire();
  syncUI();
  renderPresets();
  requestAnimationFrame(loop);
  GF.init().then(() => {
    refreshFontOptions();
    validateFont();
    syncUI();
    rebuild();
  });
  document.fonts.ready.then(rebuild);

  // exposed for automated checks / power users
  window.scribble = { state, renderFrame, rebuild, runExport };
})();
