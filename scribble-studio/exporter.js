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

  const FRAMES = {
    fit: null,
    "1080p": [1920, 1080],
    "4k": [3840, 2160],
    vertical: [1080, 1920],
    square: [1080, 1080],
  };
  const MAX_AVC = [4096, 2304];

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  /** Places boil drawings into output-sized canvases. bg: null (transparent) or a CSS colour. */
  function compose(drawings, frame, bg) {
    let [W, H] = FRAMES[frame] || [drawings[0].width, drawings[0].height];
    W = even(W); H = even(H);
    return drawings.map((d) => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
      const fixed = !!FRAMES[frame];
      const s = fixed ? Math.min(1, (W * 0.9) / d.width, (H * 0.9) / d.height) : 1;
      const dw = d.width * s, dh = d.height * s;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(d, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return c;
    });
  }

  /** which drawing shows on output frame i */
  const drawingAt = (i, fps, boil, n) => (boil > 0 ? Math.floor((i * boil) / fps) % n : 0);

  // ---------- MP4 (H.264) ----------
  function fitAvc(canvases) {
    const { width: W, height: H } = canvases[0];
    const s = Math.min(1, MAX_AVC[0] / W, MAX_AVC[1] / H);
    if (s >= 1) return canvases;
    return canvases.map((c) => {
      const o = document.createElement("canvas");
      o.width = even(W * s); o.height = even(H * s);
      o.getContext("2d").drawImage(c, 0, 0, o.width, o.height);
      return o;
    });
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

  async function mp4(canvases, { fps, boil, seconds, onProgress }) {
    canvases = fitAvc(canvases);
    const W = canvases[0].width, H = canvases[0].height;
    if (!window.VideoEncoder || !window.Mp4Muxer) return recorderFallback(canvases, { fps, boil, seconds, mp4: true });
    const bitrate = Math.min(60e6, Math.max(8e6, W * H * fps * 0.25));
    const cfg = await pickAvc(W, H, fps, bitrate);
    if (!cfg) return recorderFallback(canvases, { fps, boil, seconds, mp4: true });

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
    const total = Math.max(1, Math.round(seconds * fps));
    const dur = 1e6 / fps;
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      const vf = new VideoFrame(canvases[drawingAt(i, fps, boil, canvases.length)], { timestamp: Math.round(i * dur), duration: Math.round(dur) });
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

  async function recorderFallback(canvases, { fps, boil, seconds, mp4: wantMp4 }) {
    const mp4s = ["video/mp4;codecs=avc1.640034", "video/mp4;codecs=avc1", "video/mp4"];
    const webms = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
    const mime = wantMp4 ? pickMime(mp4s) || pickMime(webms) : pickMime(webms) || pickMime(mp4s);
    if (!mime) throw new Error("this browser can't record video");
    const c = document.createElement("canvas");
    c.width = canvases[0].width; c.height = canvases[0].height;
    const ctx = c.getContext("2d");
    const paint = (i) => { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(canvases[drawingAt(i, fps, boil, canvases.length)], 0, 0); };
    paint(0);
    const rec = new MediaRecorder(c.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 12e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    const total = Math.round(seconds * fps);
    for (let i = 0; i < total; i++) { paint(i); await new Promise((r) => setTimeout(r, 1000 / fps)); }
    rec.stop();
    await stopped;
    const type = mime.split(";")[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm" };
  }

  const webm = (canvases, opts) => recorderFallback(canvases, { ...opts, mp4: false });

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

  async function pngSequence(canvases, { fps, boil, seconds, base, onProgress }) {
    const uniques = [];
    for (const c of canvases) {
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const data = new Uint8Array(await blob.arrayBuffer());
      uniques.push({ data, crc: crc32(data) });
    }
    const total = Math.max(1, Math.round(seconds * fps));
    const files = [];
    for (let i = 0; i < total; i++) {
      const u = uniques[drawingAt(i, fps, boil, uniques.length)];
      files.push({ name: `${base}/${base}_${String(i).padStart(4, "0")}.png`, data: u.data, crc: u.crc });
      if (i % 50 === 0) onProgress && onProgress(i / total);
    }
    const readme = new TextEncoder().encode(README(base, fps, canvases[0].width, canvases[0].height));
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

  return { compose, mp4, webm, pngSequence, FRAMES };
})();
