/* In / out animation for scribble lettering.
 *
 * Each letter is a pre-rendered sprite (see buildDrawing in app.js), so animating is
 * just compositing sprites with a transform / opacity / blur / glow per frame.
 *
 *  - Effects:  fade, blur, glow, grow, slide ↑ ↓ ← →, flicker, motion blur, typewriter, write-on
 *  - Units:    whole text, word by word, or letter by letter, with stagger + order
 *  - Easing:   CSS-style cubic-bezier curves (editable graph) plus elastic / bounce / stepped
 */
window.Anim = (() => {
  "use strict";

  // ---------- easing ----------
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-6) return sy(t);
        const d = dsx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
        if (sx(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }

  const C4 = (2 * Math.PI) / 3;
  function bounceOut(x) {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  }

  /** [label, cubic-bezier or null, function for non-bezier curves] */
  const EASES = {
    linear: ["Linear", [0, 0, 1, 1]],
    ease: ["Ease", [0.25, 0.1, 0.25, 1]],
    easeIn: ["Ease in", [0.42, 0, 1, 1]],
    easeOut: ["Ease out", [0, 0, 0.58, 1]],
    easeInOut: ["Ease in-out", [0.42, 0, 0.58, 1]],
    sineIn: ["Sine in", [0.12, 0, 0.39, 0]],
    sineOut: ["Sine out", [0.61, 1, 0.88, 1]],
    sineInOut: ["Sine in-out", [0.37, 0, 0.63, 1]],
    quadIn: ["Quad in", [0.11, 0, 0.5, 0]],
    quadOut: ["Quad out", [0.5, 1, 0.89, 1]],
    quadInOut: ["Quad in-out", [0.45, 0, 0.55, 1]],
    cubicIn: ["Cubic in", [0.32, 0, 0.67, 0]],
    cubicOut: ["Cubic out", [0.33, 1, 0.68, 1]],
    cubicInOut: ["Cubic in-out", [0.65, 0, 0.35, 1]],
    quartIn: ["Quart in", [0.5, 0, 0.75, 0]],
    quartOut: ["Quart out", [0.25, 1, 0.5, 1]],
    quartInOut: ["Quart in-out", [0.76, 0, 0.24, 1]],
    expoIn: ["Expo in", [0.7, 0, 0.84, 0]],
    expoOut: ["Expo out", [0.16, 1, 0.3, 1]],
    expoInOut: ["Expo in-out", [0.87, 0, 0.13, 1]],
    circIn: ["Circ in", [0.55, 0, 1, 0.45]],
    circOut: ["Circ out", [0, 0.55, 0.45, 1]],
    circInOut: ["Circ in-out", [0.85, 0, 0.15, 1]],
    backIn: ["Back in (anticipate)", [0.36, 0, 0.66, -0.56]],
    backOut: ["Back out (overshoot)", [0.34, 1.56, 0.64, 1]],
    backInOut: ["Back in-out", [0.68, -0.6, 0.32, 1.6]],
    elasticIn: ["Elastic in", null, (x) => (x <= 0 ? 0 : x >= 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * C4))],
    elasticOut: ["Elastic out", null, (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * C4) + 1)],
    bounceIn: ["Bounce in", null, (x) => 1 - bounceOut(1 - x)],
    bounceOut: ["Bounce out", null, bounceOut],
    stepped: ["Stepped (stop-motion)", null, (x) => (x >= 1 ? 1 : Math.floor(x * 5) / 5)],
    custom: ["Custom (drag the handles)", [0.4, 0, 0.2, 1]],
  };
  const EASE_GROUPS = [
    ["Basic", ["linear", "ease", "easeIn", "easeOut", "easeInOut"]],
    ["Smooth", ["sineIn", "sineOut", "sineInOut", "quadIn", "quadOut", "quadInOut", "cubicIn", "cubicOut", "cubicInOut"]],
    ["Strong", ["quartIn", "quartOut", "quartInOut", "expoIn", "expoOut", "expoInOut", "circIn", "circOut", "circInOut"]],
    ["Playful", ["backIn", "backOut", "backInOut", "elasticIn", "elasticOut", "bounceIn", "bounceOut", "stepped"]],
    ["Custom", ["custom"]],
  ];

  function easeFn(name, bez) {
    const e = EASES[name] || EASES.linear;
    if (name === "custom" && Array.isArray(bez) && bez.length === 4) return bezier(...bez);
    if (e[1]) return bezier(...e[1]);
    return e[2];
  }

  // ---------- effects ----------
  const EFFECTS = {
    none: "None",
    fade: "Fade",
    blur: "Blur",
    glow: "Glow",
    grow: "Grow",
    slideUp: "Slide up",
    slideDown: "Slide down",
    slideLeft: "Slide left",
    slideRight: "Slide right",
    flicker: "Flicker",
    motionBlur: "Motion blur",
    typewriter: "Typewriter",
    strokeOn: "Write on (pen strokes)",
    writeOn: "Write on (wipe)",
  };
  const MOVES = { slideUp: [0, -1], slideDown: [0, 1], slideLeft: [-1, 0], slideRight: [1, 0], motionBlur: [1, 0] };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function hash(i, j, seed) {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 982451653);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  /**
   * a = how "away" the unit is: 0 = resting in place, 1 = fully hidden/away (may overshoot with back/elastic).
   * Returns draw params.
   */
  function effectParams(effect, a, phase, ctx) {
    const p = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, glow: 0, clip: null, trail: null };
    const away = phase === "in" ? -1 : 1; // in: starts opposite to the motion; out: travels along it
    switch (effect) {
      case "fade": p.alpha = 1 - a; break;
      case "blur": p.alpha = 1 - a; p.blur = Math.max(0, a) * ctx.px * 0.35; break;
      case "glow": p.alpha = clamp01((1 - a) * 1.5); p.glow = clamp01(4 * a * (1 - a) + Math.max(0, a - 0.5)) * ctx.px * 0.55; break;
      case "grow": p.scale = Math.max(0, 1 - a); break;
      case "slideUp": case "slideDown": case "slideLeft": case "slideRight": {
        const [mx, my] = MOVES[effect];
        p.dx = away * mx * a * ctx.dist;
        p.dy = away * my * a * ctx.dist;
        p.alpha = clamp01(1 - a);
        break;
      }
      case "motionBlur": {
        const d = ctx.dist * 2.6;
        p.dx = away * a * d;
        p.alpha = clamp01(1.6 * (1 - a));
        const prev = ctx.aPrev == null ? a : ctx.aPrev;
        p.trail = { dx: away * prev * d, dy: 0 };
        break;
      }
      case "flicker": {
        const shown = 1 - a;
        const r = hash(Math.floor(ctx.t * 24), ctx.unit + 1, ctx.seed);
        p.alpha = shown >= 0.98 || r < shown * shown * 1.15 ? 1 : 0.06;
        if (shown <= 0.02) p.alpha = 0;
        break;
      }
      case "typewriter": p.alpha = phase === "in" ? (a < 0.5 ? 1 : 0) : (a < 0.5 ? 1 : 0); break;
      case "strokeOn": {
        let q = clamp01(1 - a);
        if (ctx.sub && ctx.sub.m > 1) q = clamp01(q * ctx.sub.m - ctx.sub.j); // letters of a word/line in turn
        p.strokeQ = q;
        break;
      }
      case "writeOn": {
        const b = ctx.bounds;
        const w = b.x1 - b.x0;
        p.clip = phase === "in" ? [b.x0, b.x0 + clamp01(1 - a) * w] : [b.x0 + clamp01(a) * w, b.x1];
        break;
      }
      default: break;
    }
    return p;
  }

  // ---------- timeline ----------
  /** settings → normalised timing info for `units` animated units */
  function timing(A, units, lines = 1) {
    const n = Math.max(1, units);
    const spread = A.stagger * (n - 1) + (A.lineDelay || 0) * Math.max(0, lines - 1);
    const inSpan = A.in !== "none" ? A.inDur + spread : 0;
    const outSpan = A.out !== "none" ? A.outDur + spread : 0;
    const total = Math.max(A.seconds, inSpan + outSpan + (inSpan && outSpan ? 0.3 : 0.15));
    return { inSpan, outSpan, total, n };
  }

  function unitsOf(drawing, by) {
    const key = by === "word" ? "word" : by === "letter" ? "idx" : by === "line" ? "line" : null;
    const map = drawing.sprites.map((s) => (key ? s[key] : 0));
    const n = map.length ? Math.max(...map) + 1 : 1;
    const lines = drawing.sprites.length ? Math.max(...drawing.sprites.map((s) => s.line)) + 1 : 1;
    return { map, n, lines };
  }

  /** total clip length for a drawing with settings A */
  function totalFor(drawing, A) {
    const u = unitsOf(drawing, A.by);
    return timing(A, u.n, u.lines);
  }

  function orderOf(n, order, seed) {
    const o = new Array(n);
    if (order === "reverse") for (let i = 0; i < n; i++) o[i] = n - 1 - i;
    else if (order === "center") {
      // from the middle outwards; letters at equal distance start together
      const mid = (n - 1) / 2;
      for (let i = 0; i < n; i++) o[i] = Math.floor(Math.abs(i - mid) + 0.0001);
    } else if (order === "random") {
      const ids = [...Array(n).keys()].sort((x, y) => hash(x, 7, seed) - hash(y, 7, seed));
      ids.forEach((u, r) => (o[u] = r));
    } else for (let i = 0; i < n; i++) o[i] = i;
    return o;
  }

  /** { phase, a } for a unit starting `off` seconds late, at time t — or null when resting. */
  function stateAt(t, off, A, T) {
    if (A.out !== "none") {
      const os = T.total - T.outSpan + off;
      if (t >= os) return { phase: "out", a: A.easeOutFn(clamp01((t - os) / A.outDur)) };
    }
    if (A.in !== "none") {
      const is = off;
      const u = (t - is) / A.inDur;
      if (u < 1) return { phase: "in", a: 1 - A.easeInFn(clamp01(u)) };
    }
    return null;
  }

  // ---------- pen-stroke write-on ----------
  /** Zhang–Suen thinning: reduces a binary mask to a 1-pixel skeleton (in place). */
  function thin(img, w, h) {
    const del = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            if (!img[i]) continue;
            const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
            const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (A !== 1) continue;
            if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
            del.push(i);
          }
        }
        for (const i of del) img[i] = 0;
        if (del.length) changed = true;
      }
    }
  }

  /**
   * For every ink pixel of a sprite: when (0–1) the pen reaches it. Strokes are traced along the
   * skeleton from the top-left-most stroke end, following each stroke to its end before jumping.
   * Worked out on a downsampled grid (max ~220px) for speed, then looked up per pixel.
   */
  function strokeOrder(sp) {
    if (sp._stroke) return sp._stroke;
    const c = sp.c, W = c.width, H = c.height;
    const img = c.getContext("2d").getImageData(0, 0, W, H);
    const d = img.data;
    const f = Math.max(1, Math.max(W, H) / 220);
    const w = Math.max(3, Math.ceil(W / f) + 2), h = Math.max(3, Math.ceil(H / f) + 2);
    const sum = new Float32Array(w * h), cnt = new Float32Array(w * h), any = new Uint8Array(w * h);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = d[(y * W + x) * 4 + 3];
        const k = (Math.floor(y / f) + 1) * w + Math.floor(x / f) + 1;
        sum[k] += a; cnt[k]++;
        if (a > 0) any[k] = 1;
      }
    }
    const mask = new Uint8Array(w * h);
    for (let k = 0; k < mask.length; k++) mask[k] = cnt[k] && sum[k] / cnt[k] > 70 ? 1 : 0;
    const sk = mask.slice();
    thin(sk, w, h);

    const N8 = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
    const order = new Float32Array(w * h).fill(-1);
    const skel = [];
    for (let k = 0; k < sk.length; k++) if (sk[k]) skel.push(k);
    const degree = (k) => N8.reduce((s, o) => s + sk[k + o], 0);
    const key = (k) => (k % w) + Math.floor(k / w) * 0.6; // prefer starting top-left, like handwriting
    const starts = skel.filter((k) => degree(k) <= 1).sort((a, b) => key(a) - key(b))
      .concat(skel.slice().sort((a, b) => key(a) - key(b)));
    let n = 0;
    for (const s0 of starts) {
      if (order[s0] >= 0) continue;
      const stack = [s0];
      while (stack.length) {
        const k = stack.pop();
        if (order[k] >= 0) continue;
        order[k] = n++;
        // push diagonals first so straight neighbours are followed first
        for (const o of [-w - 1, -w + 1, w - 1, w + 1, -w, -1, 1, w]) if (sk[k + o] && order[k + o] < 0) stack.push(k + o);
      }
    }
    // spread the pen time from the skeleton out to the full stroke width (multi-source BFS)
    const val = new Float32Array(w * h).fill(-1);
    let queue = [];
    for (const k of skel) { val[k] = order[k]; queue.push(k); }
    if (!queue.length) { // tiny dot: reveal left→right
      for (let k = 0; k < any.length; k++) if (any[k]) { val[k] = k % w; queue.push(k); }
      n = w;
    }
    while (queue.length) {
      const next = [];
      for (const k of queue) {
        for (const o of N8) {
          const q = k + o;
          if (q >= 0 && q < val.length && any[q] && val[q] < 0) { val[q] = val[k]; next.push(q); }
        }
      }
      queue = next;
    }
    const total = Math.max(1, n);
    const o = new Float32Array(W * H);
    const alpha = new Uint8ClampedArray(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        alpha[i] = d[i * 4 + 3];
        const v = val[(Math.floor(y / f) + 1) * w + Math.floor(x / f) + 1];
        o[i] = v < 0 ? 1 : v / total;
      }
    }
    sp._stroke = { W, H, o, alpha, img, canvas: null };
    return sp._stroke;
  }

  function strokeSprite(sp, q) {
    const S = strokeOrder(sp);
    if (!S.canvas) { S.canvas = document.createElement("canvas"); S.canvas.width = S.W; S.canvas.height = S.H; }
    const d = S.img.data;
    const feather = 0.025;
    for (let i = 0, n = S.o.length; i < n; i++) {
      const a = S.alpha[i];
      if (!a) continue;
      const ov = S.o[i];
      d[i * 4 + 3] = ov <= q ? a : ov < q + feather ? a * (1 - (ov - q) / feather) : 0;
    }
    S.canvas.getContext("2d").putImageData(S.img, 0, 0);
    return S.canvas;
  }

  // ---------- drawing ----------
  const pool = new Map();
  function scratch(key, w, h) {
    let c = pool.get(key);
    if (!c) { c = document.createElement("canvas"); pool.set(key, c); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else c.getContext("2d").clearRect(0, 0, w, h);
    return c;
  }

  /** cheap, portable blur: downsample + smooth upsample (works without ctx.filter, e.g. older Safari) */
  function blurred(src, r) {
    const f = Math.min(24, 1 + r / 1.6);
    const sw = Math.max(1, Math.round(src.width / f)), sh = Math.max(1, Math.round(src.height / f));
    const small = scratch("bs" + (sw > 64 ? "L" : "S"), sw, sh);
    const sctx = small.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(src, 0, 0, sw, sh);
    const out = scratch("bo", src.width, src.height);
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(small, 0, 0, src.width, src.height);
    return out;
  }

  function drawSprite(ctx, sp, p, glowColor) {
    const alpha = clamp01(p.alpha);
    if (alpha <= 0.003 || p.scale <= 0.002) return;
    let src = sp.c;
    if (p.strokeQ != null) {
      if (p.strokeQ <= 0) return;
      if (p.strokeQ < 1) src = strokeSprite(sp, p.strokeQ);
    }
    if (p.blur > 0.6) src = blurred(src, p.blur);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (p.clip) {
      ctx.beginPath();
      ctx.rect(p.clip[0], -1e5, Math.max(0, p.clip[1] - p.clip[0]), 2e5);
      ctx.clip();
    }
    ctx.translate(sp.ax + p.dx, sp.ay + p.dy);
    if (p.scale !== 1) ctx.scale(p.scale, p.scale);
    ctx.translate(-sp.ax, -sp.ay);

    if (p.trail && Math.abs(p.trail.dx - p.dx) + Math.abs(p.trail.dy - p.dy) > 1.5) {
      // motion blur: average N copies between the previous and current position
      const ddx = p.trail.dx - p.dx, ddy = p.trail.dy - p.dy;
      const n = Math.min(24, Math.max(3, Math.ceil(Math.hypot(ddx, ddy) / 3)));
      const ox = Math.min(0, ddx), oy = Math.min(0, ddy);
      const tw = Math.ceil(src.width + Math.abs(ddx)), th = Math.ceil(src.height + Math.abs(ddy));
      const tmp = scratch("mb", tw, th);
      const tctx = tmp.getContext("2d");
      tctx.globalCompositeOperation = "lighter";
      tctx.globalAlpha = 1 / n;
      for (let i = 0; i < n; i++) tctx.drawImage(src, (ddx * i) / (n - 1) - ox, (ddy * i) / (n - 1) - oy);
      ctx.drawImage(tmp, sp.x + ox, sp.y + oy);
    } else {
      if (p.glow > 0.5) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = p.glow;
        ctx.drawImage(src, sp.x, sp.y);
        ctx.shadowBlur = p.glow * 0.4;
      }
      ctx.drawImage(src, sp.x, sp.y);
    }
    ctx.restore();
  }

  /**
   * Draws one animated frame of `drawing` at time t (seconds) into `target` (resized to the drawing).
   * A: { in, out, inDur, outDur, stagger, by, order, seconds, easeInFn, easeOutFn, steps, seed, color, fps }
   */
  function compose(drawing, t, A, target) {
    const c = target || document.createElement("canvas");
    if (c.width !== drawing.W || c.height !== drawing.H) { c.width = drawing.W; c.height = drawing.H; }
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const { map, n, lines } = unitsOf(drawing, A.by);
    const T = timing(A, n, lines);
    const slots = orderOf(n, A.order, A.seed);
    if (A.steps) t = Math.floor(t * 12 + 1e-6) / 12; // animate "on twos" like hand-drawn work
    const dt = 1 / (2 * (A.fps || 24)); // 180° shutter for motion blur

    const bounds = new Array(n);
    const members = new Array(n);
    drawing.sprites.forEach((sp, i) => {
      const u = map[i];
      const b = bounds[u] || (bounds[u] = { x0: Infinity, x1: -Infinity });
      b.x0 = Math.min(b.x0, sp.ix0); b.x1 = Math.max(b.x1, sp.ix1);
      (members[u] || (members[u] = [])).push(i);
    });
    const subOf = new Array(drawing.sprites.length);
    members.forEach((list) => list && list.forEach((i, j) => (subOf[i] = { j, m: list.length })));
    const offOf = (i) => slots[map[i]] * A.stagger + drawing.sprites[i].line * (A.lineDelay || 0);
    const dist = drawing.px * (A.by === "all" ? 1.3 : A.by === "word" ? 1.0 : 0.85);

    drawing.sprites.forEach((sp, i) => {
      const u = map[i];
      const off = offOf(i);
      const st = stateAt(t, off, A, T);
      if (!st) { ctx.drawImage(sp.c, sp.x, sp.y); return; }
      const effect = st.phase === "in" ? A.in : A.out;
      let aPrev = null;
      if (effect === "motionBlur") {
        const pst = stateAt(t - dt, off, A, T);
        aPrev = pst && pst.phase === st.phase ? pst.a : st.phase === "in" ? 1 : 0;
      }
      const p = effectParams(effect, st.a, st.phase, { px: drawing.px, dist, t, unit: u, seed: A.seed, bounds: bounds[u], aPrev, sub: subOf[i] });
      drawSprite(ctx, sp, p, A.glowColor || A.color);
    });
    return c;
  }

  // ---------- motion presets ----------
  const MOTION_KEYS = ["animIn", "animOut", "inDur", "outDur", "animBy", "stagger", "order", "lineDelay",
    "easeIn", "easeInBez", "easeOut", "easeOutBez", "steps"];
  const base = { inDur: 0.6, outDur: 0.6, animBy: "letter", stagger: 0.05, order: "forward", lineDelay: 0,
    easeIn: "cubicOut", easeInBez: [0.33, 1, 0.68, 1], easeOut: "cubicIn", easeOutBez: [0.32, 0, 0.67, 0], steps: false };
  const PRESETS = [
    ["Pop up", { ...base, animIn: "slideUp", animOut: "fade", easeIn: "backOut", stagger: 0.04, inDur: 0.5, outDur: 0.4 }],
    ["Handwritten", { ...base, animIn: "strokeOn", animOut: "fade", animBy: "letter", stagger: 0.12, inDur: 0.45, easeIn: "sineInOut", outDur: 0.5 }],
    ["Signature (one stroke)", { ...base, animIn: "strokeOn", animOut: "strokeOn", animBy: "line", stagger: 0, lineDelay: 0.4, inDur: 2.2, outDur: 1.2, easeIn: "linear", easeOut: "quadIn" }],
    ["Neon sign", { ...base, animIn: "flicker", animOut: "glow", animBy: "letter", stagger: 0.06, inDur: 0.9, outDur: 0.8, order: "random", steps: true }],
    ["Soft focus", { ...base, animIn: "blur", animOut: "blur", animBy: "word", stagger: 0.15, inDur: 0.9, outDur: 0.7, easeIn: "sineOut", easeOut: "sineIn" }],
    ["Whoosh", { ...base, animIn: "motionBlur", animOut: "motionBlur", animBy: "word", stagger: 0.08, inDur: 0.45, outDur: 0.35, easeIn: "expoOut", easeOut: "expoIn" }],
    ["Typewriter", { ...base, animIn: "typewriter", animOut: "fade", animBy: "letter", stagger: 0.07, inDur: 0.2, outDur: 0.4, easeIn: "linear" }],
    ["Bouncy grow", { ...base, animIn: "grow", animOut: "grow", animBy: "letter", stagger: 0.05, inDur: 0.8, outDur: 0.4, easeIn: "elasticOut", easeOut: "backIn" }],
    ["Line by line", { ...base, animIn: "slideUp", animOut: "slideUp", animBy: "line", stagger: 0, lineDelay: 0.35, inDur: 0.6, outDur: 0.5, easeIn: "quartOut", easeOut: "quartIn" }],
    ["Stop-motion drop", { ...base, animIn: "slideDown", animOut: "slideDown", animBy: "letter", stagger: 0.05, inDur: 0.6, outDur: 0.5, easeIn: "bounceOut", easeOut: "backIn", steps: true }],
  ];

  /** extra canvas room needed so moving letters aren't clipped (multiples of px) */
  function marginFor(A) {
    if (!A) return 0;
    const m = (e) => (e === "motionBlur" ? 2.4 : MOVES[e] ? 1.1 : e === "glow" || e === "blur" ? 0.35 : 0);
    return Math.max(m(A.in), m(A.out));
  }

  // ---------- curve editor ----------
  /** Graph with draggable cubic-bezier handles. onChange(bez) is called while dragging. */
  function CurveEditor(canvas, get, onChange) {
    const ctx = canvas.getContext("2d");
    const Y0 = -0.6, Y1 = 1.6; // value range shown (room for overshoot)
    let drag = -1;
    let t0 = performance.now();

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(120, Math.round(r.width * dpr)), h = Math.max(120, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w, h, pad: 14 * dpr, dpr };
    }
    const toPx = (S, x, y) => [S.pad + x * (S.w - 2 * S.pad), S.pad + (1 - (y - Y0) / (Y1 - Y0)) * (S.h - 2 * S.pad)];
    const fromPx = (S, px, py) => [
      Math.min(1, Math.max(0, (px - S.pad) / (S.w - 2 * S.pad))),
      Math.min(Y1, Math.max(Y0, Y0 + (1 - (py - S.pad) / (S.h - 2 * S.pad)) * (Y1 - Y0))),
    ];

    function handles() {
      const { name, bez } = get();
      if (name === "custom") return bez;
      const e = EASES[name];
      return e && e[1] ? e[1] : null;
    }

    function draw() {
      const S = size();
      const { name, bez } = get();
      const f = easeFn(name, bez);
      ctx.clearRect(0, 0, S.w, S.h);
      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = S.dpr;
      for (const v of [0, 1]) {
        const [x0, y] = toPx(S, 0, v); const [x1] = toPx(S, 1, v);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      }
      for (const v of [0, 1]) {
        const [x, y0] = toPx(S, v, Y0); const [, y1] = toPx(S, v, Y1);
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      }
      ctx.setLineDash([3 * S.dpr, 4 * S.dpr]);
      ctx.beginPath(); ctx.moveTo(...toPx(S, 0, 0)); ctx.lineTo(...toPx(S, 1, 1)); ctx.stroke();
      ctx.setLineDash([]);
      // curve
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5 * S.dpr;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = i / 120;
        const [px, py] = toPx(S, x, f(x));
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      // handles
      const h = handles();
      if (h) {
        const pts = [[0, 0, h[0], h[1]], [1, 1, h[2], h[3]]];
        pts.forEach(([ax, ay, hx, hy]) => {
          ctx.strokeStyle = "rgba(255,213,79,0.9)";
          ctx.lineWidth = 1.5 * S.dpr;
          ctx.beginPath(); ctx.moveTo(...toPx(S, ax, ay)); ctx.lineTo(...toPx(S, hx, hy)); ctx.stroke();
          ctx.fillStyle = "#ffd54f";
          ctx.beginPath(); ctx.arc(...toPx(S, hx, hy), 6 * S.dpr, 0, Math.PI * 2); ctx.fill();
        });
      }
      // travelling dot
      const u = ((performance.now() - t0) / 1600) % 1.25;
      const x = Math.min(1, u);
      const [dx, dy] = toPx(S, x, f(x));
      ctx.fillStyle = "#ff8fa3";
      ctx.beginPath(); ctx.arc(dx, dy, 5 * S.dpr, 0, Math.PI * 2); ctx.fill();
      const [, by] = toPx(S, 0, f(x));
      ctx.fillRect(S.w - 8 * S.dpr, by - 3 * S.dpr, 6 * S.dpr, 6 * S.dpr); // value marker on the right edge
    }

    function pointer(e) {
      const r = canvas.getBoundingClientRect();
      const S = size();
      return [(e.clientX - r.left) * (S.w / r.width), (e.clientY - r.top) * (S.h / r.height), S];
    }

    canvas.addEventListener("pointerdown", (e) => {
      const [px, py, S] = pointer(e);
      let h = handles();
      if (!h) return;
      const d0 = Math.hypot(...toPx(S, h[0], h[1]).map((v, i) => v - [px, py][i]));
      const d1 = Math.hypot(...toPx(S, h[2], h[3]).map((v, i) => v - [px, py][i]));
      drag = d0 < d1 ? 0 : 1; // grab the nearest handle (clicking elsewhere jumps it there)
      canvas.setPointerCapture(e.pointerId);
      move(e);
    });
    function move(e) {
      if (drag < 0) return;
      const [px, py, S] = pointer(e);
      const [x, y] = fromPx(S, px, py);
      const h = (handles() || [0.4, 0, 0.2, 1]).slice();
      h[drag * 2] = Math.round(x * 100) / 100;
      h[drag * 2 + 1] = Math.round(y * 100) / 100;
      onChange(h);
    }
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", () => (drag = -1));
    canvas.addEventListener("pointercancel", () => (drag = -1));

    return { draw, restart: () => (t0 = performance.now()) };
  }

  return { EASES, EASE_GROUPS, EFFECTS, PRESETS, MOTION_KEYS, easeFn, compose, timing, totalFor, unitsOf, marginFor, strokeOrder, CurveEditor };
})();
