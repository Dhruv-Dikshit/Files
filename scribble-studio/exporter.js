/* Editor-ready exports for Premiere Pro, DaVinci Resolve, After Effects, Final Cut.
 *
 *  - PNG sequence (.zip)  → real transparency, imports everywhere as an image sequence
 *  - MP4 on black         → set Blend/Composite mode to Screen (or Add / Linear Dodge)
 *  - MP4 on white         → set Blend/Composite mode to Multiply
 *  - MP4 on green         → Ultra Key / Keylight / 3D Keyer
 *  - WebM with alpha      → Chrome only; Resolve & AE read it, Premiere doesn't
 *
 * MP4s are encoded frame-by-frame with WebCodecs + mp4-muxer (frame-accurate, faster than
 * real time). Falls back to MediaRecorder where WebCodecs is missing.
 */
window.Exporter = (() => {
  "use strict";

  /** Base sizes (HD). "4K" doubles them: 9:16 → 2160×3840, 16:9 → 3840×2160. */
  const FRAMES = {
    fit: null,
    "9:16": [1080, 1920], // Reels, Shorts, TikTok, Stories
    "4:5": [1080, 1350],  // Instagram / Facebook feed portrait
    "3:4": [1080, 1440],  // Instagram grid (new), Pinterest-ish
    "1:1": [1080, 1080],
    "16:9": [1920, 1080], // YouTube, regular edits
  };

  /**
   * Where platform UI covers the video (fractions of the frame).
   * 9:16: profile/caption/audio bar at the bottom, like/comment/share column at the right,
   * header/tabs at the top — the strictest of Reels, Shorts and TikTok.
   */
  const SAFE = {
    "9:16": { t: 0.14, b: 0.3, l: 0.06, r: 0.16 },
    "4:5": { t: 0.05, b: 0.08, l: 0.05, r: 0.05 },
    "3:4": { t: 0.05, b: 0.08, l: 0.05, r: 0.05 },
    "1:1": { t: 0.05, b: 0.05, l: 0.05, r: 0.05 },
    "16:9": { t: 0.05, b: 0.05, l: 0.05, r: 0.05 }, // title-safe
  };

  // H.264 level 5.2 frame-size limit (in pixels), and a sane max side
  const MAX_AVC_AREA = 4096 * 2304;
  const MAX_AVC_SIDE = 4096;

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  function frameSize(spec, drawing) {
    const base = FRAMES[spec.frame];
    if (!base) return [even(drawing.width), even(drawing.height)];
    const r = spec.res || 1;
    return [base[0] * r, base[1] * r];
  }

  function safeBox(spec, W, H) {
    const s = SAFE[spec.frame] || { t: 0, b: 0, l: 0, r: 0 };
    return { x: W * s.l, y: H * s.t, w: W * (1 - s.l - s.r), h: H * (1 - s.t - s.b) };
  }

  /** Union bounding box of non-transparent pixels across drawings (the ink, without padding). */
  function contentBox(canvases) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const c of canvases) {
      const { width: W, height: H } = c;
      const d = c.getContext("2d").getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y++) {
        const row = y * W * 4;
        for (let x = 0; x < W; x++) {
          if (d[row + x * 4 + 3] > 10) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: canvases[0].width, h: canvases[0].height };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /**
   * Where to draw a drawing inside a W×H frame.
   * spec: { frame, place: "top"|"center"|"bottom", fill: % of safe width }
   */
  function placement(spec, W, H, d, cb) {
    if (!FRAMES[spec.frame]) return { x: 0, y: 0, s: 1 };
    const sb = safeBox(spec, W, H);
    const s = Math.min((sb.w * (spec.fill || 70)) / 100 / cb.w, sb.h / cb.h);
    const cx = sb.x + sb.w / 2;
    const half = (cb.h * s) / 2;
    const cy = spec.place === "top" ? sb.y + half : spec.place === "bottom" ? sb.y + sb.h - half : sb.y + sb.h / 2;
    return { x: cx - (cb.x + cb.w / 2) * s, y: cy - (cb.y + cb.h / 2) * s, s };
  }

  /** The render scale that makes the ink land at 1:1 pixels in the frame (crisp, no upscaling). */
  function idealScale(spec, cbAtScale1) {
    const [W, H] = frameSize(spec, { width: 2, height: 2 });
    const sb = safeBox(spec, W, H);
    return Math.min((sb.w * (spec.fill || 70)) / 100 / cbAtScale1.w, sb.h / cbAtScale1.h);
  }

  /**
   * Places one drawing into an output-sized canvas (reusing `target` if given).
   * bg: null (transparent) or a CSS colour. cb: content box used for placement (fixed frames).
   */
  function composeOne(d, spec, bg, cb, target) {
    if (typeof spec === "string") spec = { frame: spec };
    const [W, H] = frameSize(spec, d);
    const c = target || document.createElement("canvas");
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    const p = placement(spec, W, H, d, cb || (FRAMES[spec.frame] ? contentBox([d]) : null));
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(d, p.x, p.y, d.width * p.s, d.height * p.s);
    return c;
  }

  /** Places several drawings (sharing one content box so they line up). */
  function compose(drawings, spec, bg) {
    if (typeof spec === "string") spec = { frame: spec };
    const cb = FRAMES[spec.frame] ? contentBox(drawings) : null;
    return drawings.map((d) => composeOne(d, spec, bg, cb));
  }

  // ---------- MP4 (H.264) ----------
  /** Wraps a frame provider so frames fit H.264's size limit (downscaling only if needed). */
  function fitAvc(provider, W, H) {
    const s = Math.min(1, Math.sqrt(MAX_AVC_AREA / (W * H)), MAX_AVC_SIDE / Math.max(W, H));
    if (s >= 1) return { provider, W, H };
    const o = document.createElement("canvas");
    o.width = even(W * s); o.height = even(H * s);
    const octx = o.getContext("2d");
    return {
      W: o.width, H: o.height,
      provider: (i) => { octx.clearRect(0, 0, o.width, o.height); octx.drawImage(provider(i), 0, 0, o.width, o.height); return o; },
    };
  }

  async function pickAvc(W, H, fps, bitrate) {
    const codecs = ["avc1.640034", "avc1.640033", "avc1.64002A", "avc1.4D0034", "avc1.4D0033", "avc1.42E034", "avc1.42001F"];
    for (const codec of codecs) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: "avc" } };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r.supported) return cfg;
      } catch (_) { /* try next */ }
    }
    return null;
  }

  /**
   * provider(i) → canvas for output frame i (may reuse one canvas). total = frame count.
   */
  async function mp4(rawProvider, { fps, total, onProgress }) {
    const first = rawProvider(0);
    const { provider, W, H } = fitAvc(rawProvider, first.width, first.height);
    if (!window.VideoEncoder || !window.Mp4Muxer) return recorderFallback(provider, { fps, total, mp4: true });
    const bitrate = Math.min(60e6, Math.max(8e6, W * H * fps * 0.25));
    const cfg = await pickAvc(W, H, fps, bitrate);
    if (!cfg) return recorderFallback(provider, { fps, total, mp4: true });

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H, frameRate: fps },
      fastStart: "in-memory",
    });
    let failure = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { failure = e; },
    });
    enc.configure(cfg);
    const dur = 1e6 / fps;
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      const vf = new VideoFrame(provider(i), { timestamp: Math.round(i * dur), duration: Math.round(dur) });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      if (i % 10 === 0) { onProgress && onProgress(i / total); await new Promise((r) => setTimeout(r, 0)); }
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4" };
  }

  // ---------- MediaRecorder (fallback + WebM alpha) ----------
  function pickMime(list) {
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  }

  async function recorderFallback(provider, { fps, total, mp4: wantMp4 }) {
    const mp4s = ["video/mp4;codecs=avc1.640034", "video/mp4;codecs=avc1", "video/mp4"];
    const webms = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
    const mime = wantMp4 ? pickMime(mp4s) || pickMime(webms) : pickMime(webms) || pickMime(mp4s);
    if (!mime) throw new Error("this browser can't record video");
    const first = provider(0);
    const c = document.createElement("canvas");
    c.width = first.width; c.height = first.height;
    const ctx = c.getContext("2d");
    const paint = (i) => { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(provider(i), 0, 0); };
    paint(0);
    const rec = new MediaRecorder(c.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 12e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < total; i++) { paint(i); await new Promise((r) => setTimeout(r, 1000 / fps)); }
    rec.stop();
    await stopped;
    const type = mime.split(";")[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm" };
  }

  const webm = (provider, opts) => recorderFallback(provider, { ...opts, mp4: false });

  // ---------- PNG sequence in a .zip (store, no compression — PNG is already compressed) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, f.crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, f.data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, f.crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(cd.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + (p.byteLength || p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  /** key(i): frames with the same key are identical and get encoded once. */
  async function pngSequence(provider, { fps, total, base, key, onProgress }) {
    const cache = new Map();
    const files = [];
    let W = 0, H = 0;
    for (let i = 0; i < total; i++) {
      const k = key ? key(i) : i;
      let u = cache.get(k);
      if (!u) {
        const c = provider(i);
        W = c.width; H = c.height;
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        const data = new Uint8Array(await blob.arrayBuffer());
        u = { data, crc: crc32(data) };
        cache.set(k, u);
      }
      files.push({ name: `${base}/${base}_${String(i).padStart(4, "0")}.png`, data: u.data, crc: u.crc });
      if (i % 5 === 0) { onProgress && onProgress(i / total); await new Promise((r) => setTimeout(r, 0)); }
    }
    const readme = new TextEncoder().encode(README(base, fps, W, H));
    files.push({ name: `${base}/HOW-TO-IMPORT.txt`, data: readme, crc: crc32(readme) });
    return { blob: zip(files), ext: "zip" };
  }

  const README = (base, fps, w, h) => `${base} — PNG sequence with transparency
${w}×${h} · ${fps} fps

PREMIERE PRO
  File > Import… > select ${base}_0000.png > Options: tick "Image Sequence" > Import.
  If the speed is off: right-click the clip in the Project panel > Modify > Interpret Footage > ${fps} fps.

AFTER EFFECTS
  File > Import > File… > select ${base}_0000.png > tick "PNG Sequence". Alpha: Straight.
  Loop it: right-click > Interpret Footage > Main > Other Options: Loop N times.

DAVINCI RESOLVE
  Media page > open the folder > the frames appear as one clip (if not: ⋯ > Frame Display Mode > Sequence).
  Drag onto a track above your footage; transparency is kept.

FINAL CUT PRO
  Final Cut doesn't read PNG sequences directly. Use the "MP4 · black" export instead and set
  Inspector > Compositing > Blend Mode: Screen. (Or open the sequence in Motion and publish it.)

Made with Scribble Studio.
`;

  // ---------- animated images: GIF / APNG / Lottie ----------
  /** Wraps a provider so frames are at most `maxSide` px (animated images get huge otherwise). */
  function limitSize(provider, maxSide) {
    const first = provider(0);
    const s = Math.min(1, maxSide / Math.max(first.width, first.height));
    if (s >= 1) return { provider, W: first.width, H: first.height };
    const o = document.createElement("canvas");
    o.width = Math.max(1, Math.round(first.width * s)); o.height = Math.max(1, Math.round(first.height * s));
    const ctx = o.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    return { W: o.width, H: o.height, provider: (i) => { ctx.clearRect(0, 0, o.width, o.height); ctx.drawImage(provider(i), 0, 0, o.width, o.height); return o; } };
  }

  /** Groups consecutive identical frames (same key) so held drawings become one longer frame. */
  function runs(total, key) {
    const out = [];
    for (let i = 0; i < total; i++) {
      const k = key ? key(i) : i;
      const last = out[out.length - 1];
      if (last && last.key === k) last.len++;
      else out.push({ key: k, start: i, len: 1 });
    }
    return out;
  }

  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  async function gif(rawProvider, { fps, total, key, maxSide = 720, onProgress }) {
    const G = window.gifenc;
    if (!G) throw new Error("GIF encoder missing");
    const { provider, W, H } = limitSize(rawProvider, maxSide);
    const enc = G.GIFEncoder();
    const rs = runs(total, key);
    let carry = 0; // GIF delays are in 1/100 s — carry rounding error so timing stays exact
    for (let r = 0; r < rs.length; r++) {
      const c = provider(rs[r].start);
      const rgba = c.getContext("2d").getImageData(0, 0, W, H).data;
      const palette = G.quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 100 });
      const index = G.applyPalette(rgba, palette, "rgba4444");
      const ti = palette.findIndex((p) => p[3] === 0);
      const exact = (rs[r].len * 100) / fps + carry;
      const cs = Math.max(2, Math.round(exact));
      carry = exact - cs;
      enc.writeFrame(index, W, H, { palette, delay: cs * 10, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: 2, repeat: 0 });
      onProgress && onProgress(r / rs.length);
      if (r % 3 === 0) await yieldUI();
    }
    enc.finish();
    return { blob: new Blob([enc.bytes()], { type: "image/gif" }), ext: "gif" };
  }

  // PNG chunk helpers for APNG
  function pngChunks(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const chunks = [];
    for (let o = 8; o < u8.length;) {
      const len = dv.getUint32(o);
      const type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
      chunks.push({ type, data: u8.subarray(o + 8, o + 8 + len) });
      o += 12 + len;
    }
    return chunks;
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
  const cat = (...arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

  async function apng(rawProvider, { fps, total, key, maxSide = 1080, onProgress }) {
    const { provider, W, H } = limitSize(rawProvider, maxSide);
    const rs = runs(total, key);
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
    let seq = 0;
    for (let r = 0; r < rs.length; r++) {
      const blob = await new Promise((res) => provider(rs[r].start).toBlob(res, "image/png"));
      const chunks = pngChunks(new Uint8Array(await blob.arrayBuffer()));
      if (r === 0) {
        parts.push(chunk("IHDR", chunks.find((c) => c.type === "IHDR").data));
        parts.push(chunk("acTL", cat(u32(rs.length), u32(0)))); // loop forever
      }
      const fc = new Uint8Array(26);
      const dv = new DataView(fc.buffer);
      dv.setUint32(0, seq++); dv.setUint32(4, W); dv.setUint32(8, H); dv.setUint32(12, 0); dv.setUint32(16, 0);
      dv.setUint16(20, rs[r].len); dv.setUint16(22, fps); fc[24] = 1; fc[25] = 0; // dispose: clear, blend: source
      parts.push(chunk("fcTL", fc));
      for (const c of chunks.filter((c) => c.type === "IDAT")) {
        parts.push(r === 0 ? chunk("IDAT", c.data) : chunk("fdAT", cat(u32(seq++), c.data)));
      }
      onProgress && onProgress(r / rs.length);
      if (r % 3 === 0) await yieldUI();
    }
    parts.push(chunk("IEND", new Uint8Array(0)));
    return { blob: new Blob(parts, { type: "image/apng" }), ext: "png" };
  }

  /** Lottie JSON: each distinct drawing is an embedded PNG asset, shown by timed image layers. */
  async function lottie(rawProvider, { fps, total, key, maxSide = 720, name, onProgress }) {
    const { provider, W, H } = limitSize(rawProvider, maxSide);
    const rs = runs(total, key);
    const assets = new Map();
    const layers = [];
    for (let r = 0; r < rs.length; r++) {
      const k = String(rs[r].key);
      if (!assets.has(k)) {
        const url = provider(rs[r].start).toDataURL("image/png");
        assets.set(k, { id: "img_" + assets.size, w: W, h: H, u: "", p: url, e: 1 });
      }
      layers.push({
        ddd: 0, ind: layers.length + 1, ty: 2, nm: `frame ${rs[r].start}`, refId: assets.get(k).id, sr: 1,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [W / 2, H / 2, 0] }, a: { a: 0, k: [W / 2, H / 2, 0] }, s: { a: 0, k: [100, 100, 100] } },
        ao: 0, ip: rs[r].start, op: rs[r].start + rs[r].len, st: 0, bm: 0,
      });
      onProgress && onProgress(r / rs.length);
      if (r % 5 === 0) await yieldUI();
    }
    const json = { v: "5.7.4", fr: fps, ip: 0, op: total, w: W, h: H, nm: name || "scribble", ddd: 0, assets: [...assets.values()], layers, markers: [] };
    return { blob: new Blob([JSON.stringify(json)], { type: "application/json" }), ext: "json" };
  }

  // ---------- local helper (server.py): ProRes 4444 / HEVC alpha via ffmpeg ----------
  let helperInfo = null;
  async function helperStatus() {
    if (helperInfo) return helperInfo;
    try {
      const r = await fetch("api/status", { cache: "no-store" });
      helperInfo = r.ok ? await r.json() : { helper: false };
    } catch (_) { helperInfo = { helper: false }; }
    return helperInfo;
  }

  async function postJSON(url, body, raw) {
    const r = await fetch(url, { method: "POST", body: raw ? body : JSON.stringify(body), headers: raw ? { "Content-Type": "image/png" } : { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ? j.error + (j.detail ? ": " + j.detail.split("\n").slice(-2).join(" ") : "") : "helper error " + r.status);
    return j;
  }

  /** Uploads unique PNG frames to the helper, which runs ffmpeg. Returns { path, file (download url) }. */
  async function helperVideo(provider, { fps, total, key, format, name, onProgress }) {
    const { id } = await postJSON("api/job", {});
    const sent = new Set();
    const order = [];
    for (let i = 0; i < total; i++) {
      const k = String(key ? key(i) : i).replace(/[^A-Za-z0-9_-]/g, "_");
      order.push(k);
      if (!sent.has(k)) {
        const blob = await new Promise((res) => provider(i).toBlob(res, "image/png"));
        await postJSON(`api/job/${id}/frame/${k}`, blob, true);
        sent.add(k);
      }
      if (i % 4 === 0) onProgress && onProgress((i / total) * 0.8, "sending frames…");
    }
    onProgress && onProgress(0.85, "ffmpeg is encoding…");
    return postJSON(`api/job/${id}/finish`, { format, fps, order, name });
  }

  async function helperSave(blob, filename) {
    const r = await fetch("api/save", { method: "POST", body: blob, headers: { "X-Filename": filename } });
    if (!r.ok) throw new Error("couldn't save via helper");
    return r.json();
  }

  return { compose, composeOne, gif, apng, lottie, helperStatus, helperVideo, helperSave, mp4, webm, pngSequence, FRAMES, SAFE, frameSize, safeBox, contentBox, placement, idealScale };
})();
