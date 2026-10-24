/* Atelier — engine-trace.js
 * Turns masks and gradients into pen strokes: iso-contours (marching squares),
 * edge chains (Canny-style), polyline simplification and scan-line hatching.
 * All output is in PIXEL units of the analysis image; the planner normalises later.
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const clamp = A.clamp;

  /* ---------- polyline helpers ---------- */
  function perpDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  /** Iterative Douglas–Peucker (no recursion limit problems on long chains). */
  A.rdp = function (pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let md = 0, mi = -1;
      for (let i = s + 1; i < e; i++) {
        const d = perpDist(pts[i], pts[s], pts[e]);
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  /** Chaikin corner cutting; closed loops stay closed. */
  A.chaikin = function (pts, closed, rounds) {
    let p = pts;
    for (let r = 0; r < (rounds || 1); r++) {
      if (p.length < 3) return p;
      const out = [];
      const n = p.length;
      const last = closed ? n : n - 1;
      if (!closed) out.push(p[0]);
      for (let i = 0; i < last; i++) {
        const a = p[i], b = p[(i + 1) % n];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
        out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      if (!closed) out.push(p[n - 1]);
      p = out;
    }
    return p;
  };
  A.polyLen = function (pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
  };
  A.polyArea = function (pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  };

  /* ---------- marching squares ---------- */
  // Corner bits: tl=8 tr=4 br=2 bl=1. Edge names: T,R,B,L (midpoints of the cell sides).
  const CASES = [
    [], [['L', 'B']], [['B', 'R']], [['L', 'R']], [['T', 'R']], [['T', 'R'], ['L', 'B']],
    [['T', 'B']], [['T', 'L']], [['T', 'L']], [['T', 'B']], [['T', 'L'], ['B', 'R']],
    [['T', 'R']], [['L', 'R']], [['B', 'R']], [['L', 'B']], [],
  ];
  /** Closed boundary loops of a binary mask (1 = inside). Coordinates are pixel centres. */
  A.contours = function (mask, w, h) {
    const get = (x, y) => (mask[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)] ? 1 : 0); // replicate-pad: no fake border contour
    const segs = [];
    // doubled integer coords make every endpoint a unique integer key
    const pt = (name, x, y) =>
      name === 'T' ? [2 * x + 1, 2 * y] : name === 'R' ? [2 * x + 2, 2 * y + 1] : name === 'B' ? [2 * x + 1, 2 * y + 2] : [2 * x, 2 * y + 1];
    for (let y = -1; y < h; y++) {
      for (let x = -1; x < w; x++) {
        const c = (get(x, y) << 3) | (get(x + 1, y) << 2) | (get(x + 1, y + 1) << 1) | get(x, y + 1);
        const cs = CASES[c];
        for (let i = 0; i < cs.length; i++) segs.push([pt(cs[i][0], x, y), pt(cs[i][1], x, y)]);
      }
    }
    if (!segs.length) return [];
    const W = 4 * w + 16;
    const key = (p) => (p[0] + 4) * W + (p[1] + 4);
    const ends = new Map();
    segs.forEach((s, i) => {
      for (const p of s) {
        const k = key(p);
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push(i);
      }
    });
    const used = new Uint8Array(segs.length);
    const loops = [];
    const nextFrom = (p) => {
      const list = ends.get(key(p)) || [];
      for (const j of list) if (!used[j]) return j;
      return -1;
    };
    const extend = (chain) => {
      for (;;) {
        const tail = chain[chain.length - 1];
        const j = nextFrom(tail);
        if (j < 0) return;
        used[j] = 1;
        const s2 = segs[j];
        chain.push(key(s2[0]) === key(tail) ? s2[1] : s2[0]);
      }
    };
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const chain = [segs[i][0], segs[i][1]];
      extend(chain);
      let closed = chain.length > 2 && key(chain[0]) === key(chain[chain.length - 1]);
      if (closed) chain.pop();
      else { chain.reverse(); extend(chain); }
      // pixel centre of pixel (x,y) is at integer (x,y)
      loops.push({ pts: chain.map((p) => [p[0] / 2, p[1] / 2]), closed });
    }
    return loops;
  };

  /* ---------- edge chains ---------- */
  /** Thin, hysteresis-thresholded edges linked into polylines, strongest first. */
  A.edgeChains = function (gray, w, h, opts) {
    const o = Object.assign({ hiPct: 0.9, loRatio: 0.45, minLen: 7, eps: 0.8 }, opts || {});
    const { mag, dir } = A.sobel(gray, w, h);
    const nms = new Float32Array(w * h);
    const off = [[1, 0], [1, -1], [0, 1], [1, 1]]; // neighbour along the gradient, per dir
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x, d = off[dir[i]];
        const a = mag[(y + d[1]) * w + x + d[0]], b = mag[(y - d[1]) * w + x - d[0]];
        if (mag[i] >= a && mag[i] >= b) nms[i] = mag[i];
      }
    }
    const hi = A.percentile(mag, o.hiPct), lo = hi * o.loRatio;
    const edge = new Uint8Array(w * h);
    const stack = [];
    for (let i = 0; i < nms.length; i++) if (nms[i] >= hi) { edge[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!edge[j] && nms[j] >= lo) { edge[j] = 1; stack.push(j); }
      }
    }
    const nb = (x, y) => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && edge[(y + dy) * w + x + dx]) n++;
      }
      return n;
    };
    const seen = new Uint8Array(w * h);
    const chains = [];
    const walk = (sx, sy) => {
      const pts = [[sx, sy]];
      seen[sy * w + sx] = 1;
      let x = sx, y = sy, ms = nms[sy * w + sx];
      for (;;) {
        let best = null, bd = 9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (edge[j] && !seen[j]) {
            const d = dx && dy ? 1.5 : 1; // prefer straight steps
            if (d < bd) { bd = d; best = [xx, yy]; }
          }
        }
        if (!best) break;
        x = best[0]; y = best[1];
        seen[y * w + x] = 1;
        ms += nms[y * w + x];
        pts.push([x, y]);
      }
      return { pts, strength: ms / pts.length };
    };
    // endpoints first so open strokes start at their real ends, then leftover loops
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!edge[i] || seen[i]) continue;
        if (pass === 0 && nb(x, y) > 1) continue;
        const c = walk(x, y);
        if (c.pts.length >= o.minLen) chains.push(c);
      }
    }
    return chains
      .map((c) => ({ pts: A.chaikin(A.rdp(c.pts, o.eps), false, 1), strength: c.strength, len: c.pts.length }))
      .sort((a, b) => b.strength * Math.sqrt(b.len) - a.strength * Math.sqrt(a.len));
  };

  /** Keep only connected blobs (4-neighbour) whose pixel count is within [minA, maxA]. */
  A.filterComponents = function (mask, w, h, minA, maxA) {
    const seen = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!mask[s0] || seen[s0]) continue;
      const comp = [s0], stack = [s0];
      seen[s0] = 1;
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i / w) | 0;
        const nbs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of nbs) if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); comp.push(j); }
      }
      if (comp.length >= minA && comp.length <= maxA) for (const j of comp) out[j] = 1;
    }
    return out;
  };


  /* ---------- hand-drawn feel: flow field, streamline strokes, broken lines ---------- */
  /** Direction of structures (along edges) from the smoothed structure tensor, plus a confidence. */
  A.orientationField = function (gray, w, h, r) {
    const g = A.blur(gray, w, h, 1), n = w * h;
    const jxx = new Float32Array(n), jyy = new Float32Array(n), jxy = new Float32Array(n);
    const at = (x, y) => g[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1), i = y * w + x;
      jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy;
    }
    const a = A.blur(jxx, w, h, r), b = A.blur(jyy, w, h, r), c = A.blur(jxy, w, h, r);
    const cx = new Float32Array(n), cy = new Float32Array(n), conf = new Float32Array(n), en = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const th = 0.5 * Math.atan2(2 * c[i], a[i] - b[i]) + Math.PI / 2; // along the edge
      cx[i] = Math.cos(th); cy[i] = Math.sin(th);
      const E = a[i] + b[i];
      conf[i] = E > 1e-6 ? Math.sqrt((a[i] - b[i]) * (a[i] - b[i]) + 4 * c[i] * c[i]) / E : 0;
      en[i] = E;
    }
    const e0 = A.percentile(en, 0.6) + 1e-6;
    for (let i = 0; i < n; i++) conf[i] *= Math.min(1, en[i] / e0);
    return { cx, cy, conf };
  };

  /**
   * Long, curved shading strokes that follow the form (streamlines of the field), clipped to a
   * mask and kept ~`spacing` apart. o: { spacing, minLen, maxLen, base(deg), rotate(deg), rand, wob }
   */
  A.flowStrokes = function (mask, w, h, field, o) {
    const s = o.spacing, rand = o.rand || Math.random, base = ((o.base || 0) * Math.PI) / 180;
    const rot = ((o.rotate || 0) * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    const bx = Math.cos(base), by = Math.sin(base);
    const cs = Math.max(1, s * 0.8), gw = Math.ceil(w / cs) + 1, gh = Math.ceil(h / cs) + 1, occ = new Uint8Array(gw * gh);
    const cell = (x, y) => Math.floor(y / cs) * gw + Math.floor(x / cs);
    const dir = (x, y, px, py) => {
      const i = clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1);
      let dx = field.cx[i], dy = field.cy[i];
      if (dx * bx + dy * by < 0) { dx = -dx; dy = -dy; }
      const k = Math.min(1, field.conf[i] * 1.6);
      dx = dx * k + bx * (1 - k); dy = dy * k + by * (1 - k);
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      let rx = dx * cr - dy * sr, ry = dx * sr + dy * cr;
      if (rx * px + ry * py < 0) { rx = -rx; ry = -ry; }
      return [rx, ry];
    };
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[Math.floor(y) * w + Math.floor(x)];
    const trace = (x, y, sign, maxLen) => {
      const pts = [], ph = rand() * 6.28;
      let px = bx * sign, py = by * sign, steps = Math.floor(maxLen);
      for (let t = 0; t < steps; t++) {
        let [dx, dy] = dir(x, y, px, py);
        if (dx * px + dy * py < 0.55) break; // sharp turn: stop, a hand would lift the pencil
        const wob = (o.wob || 0.1) * Math.sin(t * 0.09 + ph); // gentle hand wander
        const ca = Math.cos(wob), sa = Math.sin(wob);
        [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
        x += dx; y += dy; px = dx; py = dy;
        if (!inside(x, y) || occ[cell(x, y)]) break;
        if (o.barrier && o.barrier[Math.floor(y) * w + Math.floor(x)]) break; // lift the pencil at a strong edge
        pts.push([x, y]);
      }
      return pts;
    };
    const seeds = [];
    for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) seeds.push([x + (rand() - 0.5) * s * 0.8, y + (rand() - 0.5) * s * 0.8]);
    for (let i = seeds.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [seeds[i], seeds[j]] = [seeds[j], seeds[i]]; }
    const out = [];
    for (const [sx, sy] of seeds) {
      if (!inside(sx, sy) || occ[cell(sx, sy)]) continue;
      if (o.barrier && o.barrier[Math.floor(sy) * w + Math.floor(sx)]) continue;
      const half = (o.maxLen || 60) / 2;
      const f = trace(sx, sy, 1, half), b = trace(sx, sy, -1, half);
      const pts = b.reverse().concat([[sx, sy]], f);
      if (pts.length < (o.minLen || 12)) continue;
      for (let k = 0; k < pts.length; k += 2) occ[cell(pts[k][0], pts[k][1])] = 1;
      out.push(A.chaikin(A.rdp(pts, 0.5), false, 2));
    }
    return out;
  };

  /** Split a polyline into several overlapping strokes, the way a hand really draws a contour. */
  A.breakUp = function (pts, minL, maxL, rand) {
    const out = [];
    let cur = [pts[0]], acc = 0, target = minL + rand() * (maxL - minL);
    for (let i = 1; i < pts.length; i++) {
      cur.push(pts[i]);
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc >= target && i < pts.length - 2) {
        out.push(cur);
        const back = Math.min(cur.length - 1, 2); // overlap a little with the previous stroke
        cur = cur.slice(cur.length - 1 - back); acc = 0; target = minL + rand() * (maxL - minL);
      }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };

  /** Smooth sideways drift so lines are not machine-straight. */
  A.wobble = function (pts, amp, rand) {
    if (pts.length < 4 || amp <= 0) return pts;
    const p1 = rand() * 6.28, p2 = rand() * 6.28, f1 = 0.05 + rand() * 0.04, f2 = 0.17 + rand() * 0.08;
    return pts.map((q, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const d = amp * (Math.sin(i * f1 + p1) * 0.7 + Math.sin(i * f2 + p2) * 0.3);
      return [q[0] + nx * d, q[1] + ny * d];
    });
  };

  /* ---------- hatching ---------- */
  /**
   * Parallel strokes clipped to a mask. Returns [[ [x,y],[x,y] ], ...] in pixel units.
   * Alternate lines are reversed so a pen would zig-zag instead of jumping back.
   */
  A.hatch = function (mask, w, h, o) {
    const spacing = o.spacing, minRun = o.minRun || 2.5;
    const th = (o.angle * Math.PI) / 180;
    const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
    const cx = w / 2, cy = h / 2, D = Math.hypot(w, h);
    const rnd = o.rand || Math.random;
    const out = [];
    let flip = false;
    for (let d = -D / 2; d <= D / 2; d += spacing) {
      const runs = [];
      let start = null, prev = null;
      for (let t = -D / 2; t <= D / 2; t += 0.6) {
        const x = cx + dx * t + nx * d, y = cy + dy * t + ny * d;
        const ix = Math.floor(x), iy = Math.floor(y);
        const inside = ix >= 0 && iy >= 0 && ix < w && iy < h && mask[iy * w + ix];
        if (inside) { if (!start) start = [x, y]; prev = [x, y]; }
        else if (start) { runs.push([start, prev]); start = null; }
      }
      if (start) runs.push([start, prev]);
      const kept = runs.filter((r) => Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) >= minRun);
      if (flip) kept.reverse();
      for (const r of kept) {
        const j = (o.jitter || 0) * 0.5;
        const a = [r[0][0] + (rnd() - 0.5) * j, r[0][1] + (rnd() - 0.5) * j];
        const b = [r[1][0] + (rnd() - 0.5) * j, r[1][1] + (rnd() - 0.5) * j];
        out.push(flip ? [b, a] : [a, b]);
      }
      flip = !flip;
    }
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
