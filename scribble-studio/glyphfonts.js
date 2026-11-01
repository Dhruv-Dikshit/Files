/* Glyph fonts: hand-drawn PNG letters (e.g. from Procreate) used as a font.
 *
 * Storage: IndexedDB, so your fonts survive reloads and never leave the device.
 *   { id, kind: "glyph", name, baseline, scale, gap, keepColors, cycle, glyphs: { "a": [Blob, …] } }
 *   { id, kind: "ttf",   name, blob }   ← uploaded .ttf/.otf files, also remembered
 *
 * Each character can hold several drawings ("variants"). They're picked at random
 * per letter, and can be cycled on each boil frame for true redrawn animation.
 */
window.GlyphFonts = (() => {
  "use strict";

  const DB_NAME = "scribble-studio";
  const STORE = "fonts";
  const MAX_H = 1024; // processed glyph height cap (keeps memory sane with 2–4K Procreate canvases)

  // ---------- IndexedDB ----------
  let dbp;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }
  const dbAll = () => tx("readonly", (s) => s.getAll());
  const dbPut = (rec) => tx("readwrite", (s) => s.put(rec));
  const dbDel = (id) => tx("readwrite", (s) => s.delete(id));

  // ---------- runtime registry ----------
  /** id -> { rec, images: { ch: [{ img, w, h }] } } */
  const fonts = new Map();

  async function decodeEntry(blob) {
    const img = await createImageBitmap(blob);
    return { img, w: img.width, h: img.height, blob };
  }

  async function hydrate(rec) {
    const images = {};
    for (const [ch, blobs] of Object.entries(rec.glyphs || {})) {
      images[ch] = await Promise.all(blobs.map(decodeEntry));
    }
    const f = { rec, images };
    fonts.set(rec.id, f);
    return f;
  }

  async function init() {
    let recs = [];
    try { recs = await dbAll(); } catch (e) { console.warn("IndexedDB unavailable", e); }
    for (const rec of recs) {
      try {
        if (rec.kind === "ttf") await registerTtf(rec);
        else await hydrate(rec);
      } catch (e) { console.warn("Couldn't load font", rec.name, e); }
    }
    return list();
  }

  function list() {
    return [...fonts.values()].map((f) => ({ id: f.rec.id, name: f.rec.name, kind: f.rec.kind || "glyph" }));
  }

  const get = (id) => fonts.get(id);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function blankFont(name) {
    return {
      id: newId(), kind: "glyph", name: name || "Ila Signature",
      baseline: 0.75, scale: 1, gap: 0.04, keepColors: false, cycle: true, glyphs: {},
    };
  }

  async function create(name) {
    const rec = blankFont(name);
    fonts.set(rec.id, { rec, images: {} });
    await save(rec.id);
    return rec.id;
  }

  async function save(id) {
    const f = fonts.get(id);
    if (!f) return;
    const glyphs = {};
    for (const [ch, arr] of Object.entries(f.images)) if (arr.length) glyphs[ch] = arr.map((e) => e.blob);
    f.rec.glyphs = glyphs;
    f.rec.updated = Date.now();
    clearCache();
    try { await dbPut(f.rec); } catch (e) { console.warn("save failed", e); }
  }

  async function remove(id) {
    fonts.delete(id);
    clearCache();
    try { await dbDel(id); } catch (_) { /* ignore */ }
  }

  // ---------- uploaded TTF/OTF persistence ----------
  async function registerTtf(rec) {
    const face = new FontFace(rec.name, await rec.blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    fonts.set(rec.id, { rec, images: {} });
  }
  async function addTtf(file) {
    const name = file.name.replace(/\.[^.]+$/, "");
    const existing = [...fonts.values()].find((f) => f.rec.kind === "ttf" && f.rec.name === name);
    if (existing) return existing.rec;
    const rec = { id: newId(), kind: "ttf", name, blob: file };
    await registerTtf(rec);
    try { await dbPut(rec); } catch (_) { /* still usable this session */ }
    return rec;
  }

  // ---------- PNG processing ----------
  /** Knocks out a white background (if any), trims side whitespace, caps size. Returns a PNG Blob. */
  async function processImage(file) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, MAX_H / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * s));
    const h = Math.max(1, Math.round(bmp.height * s));
    const c = new OffscreenCanvasOr(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // Opaque export (Procreate with the background layer visible)? Turn paper-white into transparency.
    let seeThrough = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] < 250) seeThrough++;
    if (seeThrough < d.length / 16 * 0.01) {
      for (let i = 0; i < d.length; i += 4) {
        const mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const a = Math.max(0, Math.min(255, (245 - mn) * 1.4));
        if (a <= 0) { d[i + 3] = 0; continue; }
        const k = a / 255;
        // un-mix the white paper so coloured ink keeps its colour
        d[i] = clamp255(255 - (255 - d[i]) / k);
        d[i + 1] = clamp255(255 - (255 - d[i + 1]) / k);
        d[i + 2] = clamp255(255 - (255 - d[i + 2]) / k);
        d[i + 3] = a;
      }
    }

    // trim left/right empty columns (keep full height so every letter shares a baseline)
    let minX = w, maxX = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    if (maxX < 0) throw new Error("image is empty");
    ctx.putImageData(img, 0, 0);
    const tw = maxX - minX + 1;
    const out = new OffscreenCanvasOr(tw, h);
    out.getContext("2d").drawImage(c, minX, 0, tw, h, 0, 0, tw, h);
    return toPngBlob(out);
  }

  function OffscreenCanvasOr(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const toPngBlob = (c) => new Promise((r) => c.toBlob(r, "image/png"));

  async function addGlyphs(id, ch, files) {
    const f = fonts.get(id);
    if (!f) throw new Error("no font");
    const arr = f.images[ch] || (f.images[ch] = []);
    for (const file of files) arr.push(await decodeEntry(await processImage(file)));
    await save(id);
  }

  async function clearGlyph(id, ch) {
    const f = fonts.get(id);
    if (!f) return;
    delete f.images[ch];
    await save(id);
  }

  // ---------- filename → character ----------
  const NAMED = {
    space: " ", period: ".", dot: ".", fullstop: ".", comma: ",", exclamation: "!", exclam: "!", bang: "!",
    question: "?", questionmark: "?", apostrophe: "'", quote: "\"", doublequote: "\"", colon: ":", semicolon: ";",
    dash: "-", hyphen: "-", minus: "-", underscore: "_", ampersand: "&", and: "&", at: "@", hash: "#", pound: "#",
    dollar: "$", percent: "%", plus: "+", equals: "=", equal: "=", slash: "/", backslash: "\\",
    lparen: "(", rparen: ")", openparen: "(", closeparen: ")", asterisk: "*", star: "*", caret: "^",
    tilde: "~", backtick: "`", lbracket: "[", rbracket: "]", lbrace: "{", rbrace: "}", pipe: "|",
    less: "<", lessthan: "<", greater: ">", greaterthan: ">",
  };

  /**
   * Supported names (case-insensitive file systems like macOS can't hold both a.png and A.png):
   *   a.png  A.png  a-2.png (2nd variant)  upper_a.png  a_upper.png  cap-a.png  lower_a.png
   *   question.png  comma-3.png  7.png
   */
  function parseName(filename) {
    let n = filename.replace(/\.[^.]+$/, "").trim();
    if (n.length === 1) return n;
    n = n.replace(/[-_ ]v?\d{1,2}$/i, "") || n; // strip variant suffix: a-2, a_v3
    if (n.length === 1) return n;
    let m = n.match(/^(upper|uppercase|cap|caps|capital|uc)[-_ ]?(.)$/i) || n.match(/^(.)[-_ ]?(upper|uppercase|cap|caps|capital|uc)$/i);
    if (m) return (m[1].length === 1 ? m[1] : m[2]).toUpperCase();
    m = n.match(/^(lower|lowercase|small|lc)[-_ ]?(.)$/i) || n.match(/^(.)[-_ ]?(lower|lowercase|small|lc)$/i);
    if (m) return (m[1].length === 1 ? m[1] : m[2]).toLowerCase();
    const key = n.toLowerCase().replace(/[-_ ]/g, "");
    return NAMED[key] || null;
  }

  // ---------- lookup / tint cache ----------
  function lookup(id, ch) {
    const f = fonts.get(id);
    if (!f) return null;
    const own = f.images[ch];
    if (own && own.length) return own;
    const alt = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
    const other = f.images[alt];
    return other && other.length ? other : null;
  }

  let cache = new Map();
  function clearCache() { cache = new Map(); }

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function offsets(r) {
    const pts = [[0, 0]];
    const rings = r > 3 ? [r, r * 0.5] : [r];
    for (const rr of rings) {
      const n = Math.min(32, Math.max(8, Math.ceil((2 * Math.PI * rr) / 1.5)));
      for (let i = 0; i < n; i++) pts.push([Math.cos((i / n) * 2 * Math.PI) * rr, Math.sin((i / n) * 2 * Math.PI) * rr]);
    }
    return pts;
  }

  /** dilate (grow) or erode (shrink) a glyph by r pixels. */
  function morph(src, r, mode) {
    const pad = Math.ceil(r) + 1;
    const out = canvas(src.width + pad * 2, src.height + pad * 2);
    const ctx = out.getContext("2d");
    const pts = offsets(r);
    if (mode === "dilate") {
      for (const [dx, dy] of pts) ctx.drawImage(src, pad + dx, pad + dy);
    } else {
      ctx.drawImage(src, pad, pad);
      ctx.globalCompositeOperation = "destination-in";
      for (const [dx, dy] of pts) ctx.drawImage(src, pad + dx, pad + dy);
    }
    return { canvas: out, pad };
  }

  /**
   * Returns { canvas, pad } — the glyph scaled to height h, tinted, thickened/thinned or outlined.
   * opts: { color, thick (px, ±), outline (bool), outlineW (px), keepColors (bool) }
   */
  function render(entry, h, opts) {
    const key = [entry.blob.size, entry.w, Math.round(h), opts.color, Math.round(opts.thick * 4), opts.outline, Math.round(opts.outlineW * 4), opts.keepColors].join("|");
    const k2 = cacheKey(entry) + key;
    const hit = cache.get(k2);
    if (hit) return hit;
    if (cache.size > 600) clearCache();

    const w = (entry.w * h) / entry.h;
    const base = canvas(w, h);
    const bctx = base.getContext("2d");
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(entry.img, 0, 0, base.width, base.height);
    const tint = !opts.keepColors || opts.outline || opts.forceTint;
    if (tint) {
      bctx.globalCompositeOperation = "source-in";
      bctx.fillStyle = opts.color;
      bctx.fillRect(0, 0, base.width, base.height);
    }

    let res;
    if (opts.outline) {
      const d = morph(base, Math.max(1, opts.outlineW), "dilate");
      const ctx = d.canvas.getContext("2d");
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(base, d.pad, d.pad);
      res = d;
    } else if (opts.thick > 0.5) {
      res = morph(base, opts.thick, "dilate");
    } else if (opts.thick < -0.5) {
      res = morph(base, -opts.thick, "erode");
    } else {
      res = { canvas: base, pad: 0 };
    }
    cache.set(k2, res);
    return res;
  }

  const ids = new WeakMap();
  let idSeq = 0;
  function cacheKey(entry) {
    if (!ids.has(entry)) ids.set(entry, ++idSeq);
    return ids.get(entry) + "#";
  }

  // ---------- packs (share / back up a font as one file) ----------
  const blobToDataURL = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

  async function exportPack(id) {
    const f = fonts.get(id);
    const glyphs = {};
    for (const [ch, arr] of Object.entries(f.images)) glyphs[ch] = await Promise.all(arr.map((e) => blobToDataURL(e.blob)));
    const { name, baseline, scale, gap, keepColors, cycle } = f.rec;
    const pack = { format: "scribble-studio-font", version: 1, name, baseline, scale, gap, keepColors, cycle, glyphs };
    return new Blob([JSON.stringify(pack)], { type: "application/json" });
  }

  async function importPack(file) {
    const pack = JSON.parse(await file.text());
    if (pack.format !== "scribble-studio-font") throw new Error("not a Scribble Studio font pack");
    const rec = blankFont(pack.name);
    for (const k of ["baseline", "scale", "gap", "keepColors", "cycle"]) if (k in pack) rec[k] = pack[k];
    const images = {};
    for (const [ch, urls] of Object.entries(pack.glyphs || {})) {
      images[ch] = await Promise.all(urls.map(async (u) => decodeEntry(await (await fetch(u)).blob())));
    }
    fonts.set(rec.id, { rec, images });
    await save(rec.id);
    return rec.id;
  }

  // ---------- Procreate template ----------
  /** 1000×1000 guide sheet: draw one letter per export, hide this layer, export PNG. */
  function template(baseline = 0.75) {
    const S = 1000;
    const c = canvas(S, S);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, S, S);
    const line = (y, color, label, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = color; ctx.font = "26px sans-serif"; ctx.fillText(label, 14, y - 10);
    };
    const B = S * baseline;
    line(B - S * 0.55, "#9aa6ff", "cap height / ascender", [14, 10]);
    line(B - S * 0.33, "#ffb37a", "x-height (lowercase)", [14, 10]);
    line(B, "#ff4d6d", "BASELINE — letters sit here");
    line(B + S * 0.18, "#9aa6ff", "descender (g, j, p, q, y)", [14, 10]);
    ctx.fillStyle = "#b9b9b9"; ctx.font = "24px sans-serif";
    ctx.fillText("Scribble Studio glyph template · same canvas for every letter · hide this layer before export", 14, S - 22);
    return c;
  }

  return {
    init, list, get, create, save, remove, addTtf,
    addGlyphs, clearGlyph, parseName, lookup, render, processImage,
    exportPack, importPack, template, clearCache,
  };
})();
