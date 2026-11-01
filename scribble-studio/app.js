/* Scribble Studio — hand-drawn animated text generator.
 *
 * Pipeline for every frame:
 *   1. layout + draw each glyph with a tiny random transform ("wobble")
 *   2. adjust stroke thickness (dilate with a stroke / erode with destination-out)
 *   3. displace pixels with seeded value-noise ("roughness")  -> marker-like edges
 *   4. optional crayon grain
 * Several frames are generated with different seeds and cycled at N fps
 * to create the classic hand-drawn "line boil" animation.
 */
(() => {
  "use strict";

  const FONTS = [
    "Gochi Hand", "Caveat", "Permanent Marker", "Rock Salt", "Indie Flower",
    "Shadows Into Light", "Gaegu", "Patrick Hand", "Nanum Pen Script",
    "Reenie Beanie", "Covered By Your Grace", "Schoolbell", "Kalam",
  ];
  const SWATCHES = ["#3b4fd8", "#111111", "#e5484d", "#f5a524", "#12a150", "#ffffff"];
  const BOIL_FRAMES = 4;
  const THICKNESS = { thin: -0.016, regular: 0, bold: 0.022, heavy: 0.042 };

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
    boil: 10,
    bgMode: "transparent",
    bgColor: "#ffffff",
    scale: 2,
    videoFormat: "webm",
    seed: 1,
  };

  const state = { ...DEFAULTS };
  const $ = (id) => document.getElementById(id);
  const preview = $("preview");
  const pctx = preview.getContext("2d");

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
    return (n >>> 0) / 4294967295;
  }

  /** Builds a lookup grid of random values; sampling it bilinearly gives smooth value-noise. */
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

  // ---------- layout ----------
  function fontString(px) {
    return `${px}px "${state.font}"`;
  }

  function layout(ctx, px) {
    ctx.font = fontString(px);
    const lines = state.text.replace(/\r/g, "").split("\n");
    const spacing = (state.spacing / 100) * px;
    const laid = lines.map((line) => {
      const chars = [...line];
      const xs = [];
      let prefix = "";
      for (let k = 0; k < chars.length; k++) {
        // using prefix widths keeps the font's kerning
        xs.push(ctx.measureText(prefix).width + k * spacing);
        prefix += chars[k];
      }
      const width = chars.length ? ctx.measureText(line).width + (chars.length - 1) * spacing : 0;
      return { chars, xs, width };
    });
    const maxW = Math.max(1, ...laid.map((l) => l.width));
    return { laid, maxW };
  }

  // ---------- rendering ----------
  /** Renders one frame at a given pixel scale and returns a canvas. */
  function renderFrame(scale, frameSeed) {
    const px = state.size * scale;
    const measure = document.createElement("canvas").getContext("2d");
    const { laid, maxW } = layout(measure, px);

    const rough = state.roughness;
    const lineH = px * state.lineHeight;
    const shadowOff = state.style === "shadow" ? state.shadowOffset * scale : 0;
    const pad = Math.ceil(px * 0.45 + rough * px * 0.02 + shadowOff + Math.abs(THICKNESS[state.thickness]) * px);
    const W = Math.ceil(maxW + pad * 2 + shadowOff);
    const H = Math.ceil(lineH * (laid.length - 1) + px * 1.25 + pad * 2 + shadowOff);

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.font = fontString(px);
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const rand = mulberry32(state.seed * 7919 + frameSeed * 104729);
    const wob = state.wobble;
    const thick = THICKNESS[state.thickness] * px;
    const outline = state.style === "outline";
    const outlineW = Math.max(1.5 * scale, px * 0.03 + Math.max(0, thick));

    // Pick each glyph's position + jitter once, so every pass (shadow, ink, erosion) lines up.
    const glyphs = [];
    laid.forEach((line, li) => {
      let x0 = pad;
      if (state.align === "center") x0 = pad + (maxW - line.width) / 2;
      else if (state.align === "right") x0 = pad + (maxW - line.width);
      const baseY = pad + px * 0.95 + li * lineH;
      line.chars.forEach((ch, k) => {
        if (ch === " ") return;
        const w = measure.measureText(ch).width;
        glyphs.push({
          ch, w,
          x: x0 + line.xs[k] + w / 2 + (rand() * 2 - 1) * wob * px * 0.004,
          y: baseY + (rand() * 2 - 1) * wob * px * 0.008,
          rot: (rand() * 2 - 1) * wob * 0.035, // radians
          sc: 1 + (rand() * 2 - 1) * wob * 0.012,
        });
      });
    });

    const eachGlyph = (dx, dy, fn) => {
      for (const g of glyphs) {
        ctx.save();
        ctx.translate(g.x + dx, g.y + dy);
        ctx.rotate(g.rot);
        ctx.scale(g.sc, g.sc);
        fn(g.ch, -g.w / 2);
        ctx.restore();
      }
    };

    const drawGlyphs = (color, dx, dy) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      eachGlyph(dx, dy, (ch, x) => {
        if (outline) {
          ctx.lineWidth = outlineW;
          ctx.strokeText(ch, x, 0);
        } else {
          if (thick > 0) { ctx.lineWidth = thick * 2; ctx.strokeText(ch, x, 0); }
          ctx.fillText(ch, x, 0);
        }
      });
    };

    const layers = state.style === "shadow" ? [[state.shadowColor, shadowOff], [state.color, 0]] : [[state.color, 0]];
    for (const [color, off] of layers) {
      drawGlyphs(color, off, off);
      // thin: erode this layer's edges before the next layer goes on top
      if (thick < 0 && !outline) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = -thick * 2;
        ctx.strokeStyle = "#000";
        eachGlyph(off, off, (ch, x) => ctx.strokeText(ch, x, 0));
        ctx.restore();
      }
    }

    if (rough > 0) displace(ctx, W, H, px, rough, frameSeed);
    if (state.style === "crayon") crayon(ctx, W, H, px, frameSeed);
    return c;
  }

  /** Marker-edge effect: shifts each pixel by two octaves of smooth noise. */
  function displace(ctx, W, H, px, rough, frameSeed) {
    const src = ctx.getImageData(0, 0, W, H);
    const out = ctx.createImageData(W, H);
    const s = src.data, o = out.data;
    const seed = state.seed * 31 + frameSeed * 1013;
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
  function crayon(ctx, W, H, px, frameSeed) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const seed = state.seed * 17 + frameSeed * 7;
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

  // ---------- frame cache & animation ----------
  let previewFrames = [];
  let renderToken = 0;

  async function ensureFont() {
    try { await document.fonts.load(fontString(state.size), state.text || "a"); } catch (_) { /* ignore */ }
  }

  async function rebuild() {
    const token = ++renderToken;
    await ensureFont();
    if (token !== renderToken) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const count = state.boil > 0 ? BOIL_FRAMES : 1;
    const frames = [];
    for (let f = 0; f < count; f++) {
      frames.push(renderFrame(dpr, f));
      // yield so slider dragging stays responsive
      await new Promise((r) => setTimeout(r, 0));
      if (token !== renderToken) return;
    }
    previewFrames = frames;
    preview.width = frames[0].width;
    preview.height = frames[0].height;
    preview.style.width = frames[0].width / dpr + "px";
    preview.style.height = "auto";
    drawPreview(performance.now(), true);
  }

  let lastIdx = -1;
  function drawPreview(t, force) {
    if (!previewFrames.length) return;
    const idx = state.boil > 0 ? Math.floor((t / 1000) * state.boil) % previewFrames.length : 0;
    if (idx === lastIdx && !force) return;
    lastIdx = idx;
    pctx.clearRect(0, 0, preview.width, preview.height);
    if (state.bgMode === "solid") {
      pctx.fillStyle = state.bgColor;
      pctx.fillRect(0, 0, preview.width, preview.height);
    }
    pctx.drawImage(previewFrames[idx], 0, 0);
  }

  function loop(t) {
    drawPreview(t, false);
    requestAnimationFrame(loop);
  }

  let debounceT;
  function schedule() {
    clearTimeout(debounceT);
    debounceT = setTimeout(rebuild, 40);
    persist();
  }

  // ---------- export ----------
  function filename(ext) {
    const slug = (state.text.trim().split("\n")[0] || "scribble")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "scribble";
    return `${slug}-scribble.${ext}`;
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportCanvas() {
    await ensureFont();
    const frame = renderFrame(state.scale, 0);
    if (state.bgMode !== "solid") return frame;
    const c = document.createElement("canvas");
    c.width = frame.width; c.height = frame.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(frame, 0, 0);
    return c;
  }

  const toBlob = (c, type = "image/png") => new Promise((r) => c.toBlob(r, type));

  async function exportPng() {
    const c = await exportCanvas();
    download(await toBlob(c), filename("png"));
    toast(`Saved ${c.width}×${c.height} PNG`);
  }

  async function copyPng() {
    try {
      const c = await exportCanvas();
      const blob = await toBlob(c);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("PNG copied — paste it into Figma, Keynote, Premiere…");
    } catch (e) {
      toast("Clipboard not available in this browser — use save png instead");
    }
  }

  async function exportSvg() {
    const c = await exportCanvas();
    const url = c.toDataURL("image/png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><image href="${url}" width="${c.width}" height="${c.height}"/></svg>`;
    download(new Blob([svg], { type: "image/svg+xml" }), filename("svg"));
    toast("Saved SVG");
  }

  function pickMime(format) {
    const options = format === "mp4"
      ? ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"]
      : ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
    return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  }

  async function exportVideo() {
    if (!window.MediaRecorder) return toast("Video recording isn't supported in this browser");
    let format = state.videoFormat;
    let mime = pickMime(format);
    if (!mime) {
      format = format === "mp4" ? "webm" : "mp4";
      mime = pickMime(format);
      if (!mime) return toast("No supported video codec found");
      toast(`${state.videoFormat.toUpperCase()} not supported here — saving ${format.toUpperCase()}`);
    }
    const btn = $("exportVideo");
    btn.disabled = true;
    btn.textContent = "rendering…";
    try {
      await ensureFont();
      const fps = state.boil > 0 ? state.boil : 10;
      const count = state.boil > 0 ? BOIL_FRAMES : 1;
      const frames = [];
      for (let f = 0; f < count; f++) {
        frames.push(renderFrame(state.scale, f));
        await new Promise((r) => setTimeout(r, 0));
      }
      const c = document.createElement("canvas");
      // H.264 needs even dimensions
      c.width = frames[0].width + (frames[0].width % 2);
      c.height = frames[0].height + (frames[0].height % 2);
      const ctx = c.getContext("2d");
      // MP4 has no alpha channel, so fall back to the background colour (white by default)
      const solid = state.bgMode === "solid" || format === "mp4";
      const paint = (i) => {
        ctx.clearRect(0, 0, c.width, c.height);
        if (solid) { ctx.fillStyle = state.bgColor; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(frames[i % frames.length], 0, 0);
      };
      paint(0);
      const stream = c.captureStream(fps);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      const durationMs = 4000;
      const total = Math.round((durationMs / 1000) * fps);
      btn.textContent = "recording…";
      for (let i = 0; i < total; i++) {
        paint(i);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      rec.stop();
      await done;
      download(new Blob(chunks, { type: mime.split(";")[0] }), filename(format));
      toast(`Saved ${format.toUpperCase()}${format === "webm" && !solid ? " with transparency" : ""}`);
    } catch (e) {
      console.error(e);
      toast("Video export failed: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "save video";
    }
  }

  // ---------- persistence, presets, sharing ----------
  const STORE = "scribble-studio:v1";
  const PRESETS = "scribble-studio:presets:v1";
  const SHAREABLE = Object.keys(DEFAULTS);

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { /* private mode */ }
  }

  function loadInitial() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (saved) Object.assign(state, pick(saved));
    } catch (_) { /* ignore */ }
    if (location.hash.length > 1) {
      try {
        const fromHash = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
        Object.assign(state, pick(fromHash));
      } catch (_) { /* bad link */ }
    }
    if (!FONTS.includes(state.font)) state.font = DEFAULTS.font; // uploaded fonts don't survive reloads
  }

  function pick(obj) {
    const out = {};
    for (const k of SHAREABLE) if (k in obj && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
    return out;
  }

  async function shareLink() {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    const url = `${location.origin}${location.pathname}#${encoded}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied — anyone opening it gets this exact style"); }
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
      b.style.fontFamily = `"${p.state.font}"`;
      b.onclick = (e) => {
        if (e.target.classList.contains("x")) {
          const l = getPresets(); l.splice(i, 1); setPresets(l); return;
        }
        const keepText = state.text;
        Object.assign(state, pick(p.state), { text: keepText });
        syncUI(); schedule();
      };
      box.appendChild(b);
    });
  }

  // ---------- UI wiring ----------
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function addFontOption(name) {
    const o = document.createElement("option");
    o.value = name; o.textContent = name; o.style.fontFamily = `"${name}"`;
    $("font").appendChild(o);
  }

  const sliders = ["size", "spacing", "lineHeight", "roughness", "wobble"];

  function syncUI() {
    $("font").value = state.font;
    $("font").style.fontFamily = `"${state.font}"`;
    $("text").value = state.text;
    $("text").style.fontFamily = `"${state.font}", var(--ui-font)`;
    sliders.forEach((k) => { $(k).value = state[k]; $(k + "Val").textContent = state[k]; });
    $("color").value = state.color;
    $("colorHex").value = state.color.toUpperCase();
    $("shadowColor").value = state.shadowColor;
    $("shadowOffset").value = state.shadowOffset;
    $("bgColor").value = state.bgColor;
    $("shadowCtrl").hidden = state.style !== "shadow";
    document.querySelectorAll(".seg").forEach((seg) => {
      const key = seg.dataset.key;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(state[key])));
    });
  }

  function wire() {
    FONTS.forEach(addFontOption);
    $("font").onchange = (e) => { state.font = e.target.value; syncUI(); schedule(); };

    $("fontUpload").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const name = file.name.replace(/\.[^.]+$/, "");
        const face = new FontFace(name, await file.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        if (![...$("font").options].some((o) => o.value === name)) addFontOption(name);
        state.font = name;
        syncUI(); schedule();
        toast(`Loaded "${name}" — it stays on your device`);
      } catch (err) {
        toast("Couldn't read that font file");
      }
      e.target.value = "";
    };

    $("text").addEventListener("input", (e) => { state.text = e.target.value; schedule(); });
    $("text").addEventListener("keydown", (e) => {
      // plain Enter keeps a single line feel; Shift+Enter inserts a newline (textarea default)
      if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
    });

    sliders.forEach((k) => {
      $(k).addEventListener("input", (e) => {
        state[k] = parseFloat(e.target.value);
        $(k + "Val").textContent = state[k];
        schedule();
      });
    });

    document.querySelectorAll(".seg").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const key = seg.dataset.key;
        const v = b.dataset.v;
        state[key] = typeof DEFAULTS[key] === "number" ? parseFloat(v) : v;
        syncUI();
        if (key !== "videoFormat" && key !== "scale") schedule(); else persist();
        if (key === "bgMode") drawPreview(performance.now(), true);
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
      if (state.bgMode !== "solid") { state.bgMode = "solid"; syncUI(); }
      persist();
      drawPreview(performance.now(), true);
    });

    $("exportPng").onclick = exportPng;
    $("exportVideo").onclick = exportVideo;
    $("copyPng").onclick = copyPng;
    $("exportSvg").onclick = exportSvg;
    $("reseed").onclick = () => { state.seed = (Math.random() * 1e6) | 0; schedule(); };
    $("share").onclick = shareLink;
    $("savePreset").onclick = () => {
      const name = prompt("Name this look:", `${state.font} ${state.style}`);
      if (!name) return;
      const list = getPresets();
      list.push({ name: name.slice(0, 40), state: { ...state } });
      setPresets(list);
    };

    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); exportPng(); }
    });
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", schedule);
  }

  loadInitial();
  wire();
  syncUI();
  renderPresets();
  document.fonts.ready.then(rebuild);
  rebuild();
  requestAnimationFrame(loop);

  // exposed for automated checks / power users
  window.scribble = { state, renderFrame, rebuild };
})();
