/**
 * The setup wizard's backdrop: an ASCII Yggdrasil that grows on a canvas, cropped by the
 * right edge so only ~3/4 of its width shows. Its roots start organic under the ground and
 * fray into circuit traces ("|" "/" "\" "-" "+", vias "o"/"O") that amber pulses run down.
 * One glowing "realm" in the crown per wizard step lights up as the steps are completed.
 *
 * The shape is generated on a coarse grid with a fixed seed (same tree every time) and
 * rasterized SCALE times finer, then sampled once per character cell. Glyphs that finished
 * their "decode" are painted once onto an offscreen layer, so each frame only redraws what is
 * still moving. Call dispose() on unmount: it stops the animation loop and the resize observer.
 */

export type AsciiTree = {
  /** Replays the growth from an empty canvas. */
  restart(): void;
  /** Steps before `i` are lit; step `i` pulses. -1 = none. */
  setLit(i: number): void;
  /** Lights every realm and drops a flurry of leaves (the "Enter" moment). */
  bloom(): void;
  /** Finishes the growth quickly (the window booted before the tree did). */
  hurry(): void;
  dispose(): void;
};

type Kind = "wood" | "root" | "leaf";
type Cell = { x: number; y: number; kind: Kind; birth: number; ang?: number; edge?: number; r?: number; cl?: number; dn?: number };
type Tip = { x: number; y: number; b: number; mid?: boolean };
type Glyph = {
  x: number; y: number; ch: string; color: string; alpha: number; birth: number;
  leaf: boolean; n: number; root?: boolean; col?: number; row?: number;
};
type TracePoint = { c: number; r: number; ch: string; birth: number; via?: boolean; x: number; y: number };
type TraceStart = { c: number; r: number; side: number; fan: number; birth: number; depth: number; jogFirst: number; cutoff: number };
type Orb = { x: number; y: number; on: number; yy: number };
type Particle = { x: number; y: number; vx: number; vy: number; ch: string; life: number };
type Pulse = { path: TracePoint[]; i: number; v: number };

// Shape grid and its finer raster.
const GW = 170, GH = 140, GROUND = 100, SCALE = 1.7;
const SW = Math.ceil(GW * SCALE), SH = Math.ceil(GH * SCALE), SGROUND = Math.round(GROUND * SCALE), SCX = (GW / 2) * SCALE;
const ROOT_BAND = 7 * SCALE; // fine-grid rows of organic root under the ground before they become traces
const VISIBLE = 0.75; // share of the tree's width that stays on screen
const FONT_PX = 8;
const FONT_FAMILY = `"JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, monospace`;
const FONT = `${FONT_PX}px ${FONT_FAMILY}`;
const ORB_FONT = `700 13px ${FONT_FAMILY}`;
const INK = "232,214,194", AMBER = "240,180,106", FLAME = "217,119,87";
const SPEED = 34 * SCALE; // fine-grid cells of growth per second
const DECODE = 6 * SCALE;
const SCRAMBLE = "01#$%&*+=/\\|<>{}[]?";
const DENSE = "@#%&8", MID = "*+=x%", LIGHT = ":;~-", EDGE = ".'`,";

function rng(seed: number): () => number {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Stable per-character noise in [0, 1). */
function hash(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) >>> 0;
  x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296; // >>> 0: JS xor is signed
}

function buildShape() {
  const R = rng(7), N = rng(99); // R drives the shape, N only the fine-grid rim noise
  const map = new Map<number, Cell>();
  const put = (x: number, y: number, kind: Kind, birth: number, extra: Partial<Cell> = {}) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    const k = x + y * SW, cur = map.get(k);
    if (cur && kind === "leaf") return; // first cluster to claim a cell keeps it
    if (!cur || kind === "wood" || birth < cur.birth) map.set(k, { x, y, kind, birth, ...extra });
  };
  const tips: Tip[] = [];
  const SUB = Math.ceil(SCALE);
  const limb = (x: number, y: number, ang: number, len: number, thick: number, depth: number, birth: number, root: boolean, drawScale = 1): void => {
    if (!root && depth <= 1) tips.push({ x, y, b: birth, mid: true }); // foliage along the outer limbs too
    const steps = Math.ceil(len);
    for (let i = 0; i <= steps; i++) {
      const th = thick * (1 - (i / steps) * 0.35);
      const rS = Math.max(0.5, th / 2) * SCALE;
      for (let j = 0; j < SUB; j++) {
        const t = i + j / SUB;
        const cx = (x + Math.cos(ang) * t * drawScale) * SCALE, cy = (y + Math.sin(ang) * t * drawScale) * SCALE;
        for (let dx = -Math.ceil(rS); dx <= Math.ceil(rS); dx++) for (let dy = -Math.ceil(rS); dy <= Math.ceil(rS); dy++)
          if (dx * dx + dy * dy <= rS * rS + 0.3)
            put(cx + dx, cy + dy, root ? "root" : "wood", (birth + t) * SCALE, { ang, edge: Math.abs(dx) >= rS - 0.7 ? Math.sign(dx) : 0, r: rS / SCALE });
      }
      ang += (R() - 0.5) * 0.08;
    }
    const ex = x + Math.cos(ang) * steps * drawScale, ey = y + Math.sin(ang) * steps * drawScale, eb = birth + steps;
    if (depth <= 0) { if (!root) tips.push({ x: ex, y: ey, b: eb }); return; }
    const n = root ? 2 : R() < 0.35 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const spread = root ? 0.55 : 0.42 + R() * 0.25;
      const a = ang + (n === 2 ? (k ? spread : -spread) : (k - 1) * spread * 1.1) + (R() - 0.5) * 0.15;
      limb(ex, ey, a, len * (0.68 + R() * 0.12), thick * 0.66, depth - 1, eb, root);
    }
  };
  const bx = GW / 2;
  limb(bx, GROUND, -Math.PI / 2, 24, 7, 5, 0, false, 0.9); // trunk drawn 10% short; the crown keeps its shape
  limb(bx, GROUND + 1, Math.PI / 2 + 0.7, 9, 4, 3, 4, true);
  limb(bx, GROUND + 1, Math.PI / 2 - 0.7, 9, 4, 3, 4, true);
  limb(bx, GROUND + 1, Math.PI / 2, 7, 3, 2, 6, true);
  tips.forEach((tp, cl) => {
    const rad = (tp.mid ? 2.8 : 3.6) + R() * 2.6, radS = rad * SCALE;
    for (let dx = -Math.ceil(radS); dx <= radS; dx++) for (let dy = -Math.ceil(radS); dy <= radS * 0.85; dy++) {
      const d = Math.hypot(dx, dy * 1.15) / SCALE;
      if (d <= rad * (0.82 + N() * 0.3)) put(tp.x * SCALE + dx, tp.y * SCALE + dy, "leaf", (tp.b + 2 + d * 1.6 + N() * 4) * SCALE, { cl, dn: d / rad });
    }
  });
  const box = { x0: SW, x1: 0, y0: SH, y1: 0 };
  for (const c of map.values()) {
    box.x0 = Math.min(box.x0, c.x); box.x1 = Math.max(box.x1, c.x);
    box.y0 = Math.min(box.y0, c.y); box.y1 = Math.max(box.y1, c.y);
  }
  return { map, box, tips: tips.map((tp) => ({ ...tp, x: tp.x * SCALE, y: tp.y * SCALE })) };
}

/** Branches follow their angle; foliage gets denser toward each cluster's heart. */
function glyphFor(c: Cell, n: number): string {
  if (c.kind === "leaf") {
    const dn = c.dn ?? 1;
    const set = dn < 0.45 ? DENSE : dn < 0.75 ? MID : dn < 0.92 ? LIGHT : EDGE;
    return set[Math.floor(n * set.length)];
  }
  const cs = Math.cos(c.ang ?? 0), sn = Math.sin(c.ang ?? 0), r = c.r ?? 0;
  if (r >= 1.6 && c.edge) return Math.abs(cs) < 0.35 ? (c.edge < 0 ? "(" : ")") : Math.abs(sn) < 0.35 ? "_" : cs * sn < 0 ? "/" : "\\";
  if (Math.abs(cs) < 0.35) return r >= 1.6 ? "|!:|"[Math.floor(n * 4)] : "|";
  if (Math.abs(sn) < 0.35) return n < 0.5 ? "_" : "-";
  return cs * sn < 0 ? "/" : "\\";
}

export function createAsciiTree(canvas: HTMLCanvasElement, opts: { realms: number; reducedMotion: boolean }): AsciiTree {
  const ctx = canvas.getContext("2d")!;
  const layer = document.createElement("canvas"); // settled glyphs are painted here once
  const lctx = layer.getContext("2d")!;
  const { map, box, tips } = buildShape();
  const reduce = opts.reducedMotion;

  let CW = FONT_PX * 0.6, CH = FONT_PX * 1.08;
  let glyphs: Glyph[] = [], traces: TracePoint[][] = [], orbs: Orb[] = [];
  let u = 6, ox = 0, oy = 0, w = 0, h = 0;
  let gAcc = 0, last = 0, rate = 1, lit = -1, bloomAt = 0, raf = 0, settled = 0, ready = false, disposed = false;
  let particles: Particle[] = [], pulses: Pulse[] = [], flick: { e: Glyph; until: number }[] = [];

  function buildCircuit() {
    const R = rng(42), owner = new Map<string, number>(), key = (c: number, r: number) => c + "," + r;
    traces = [];
    const c0 = Math.round((ox + SCX * u) / CW);
    const groundY = oy + (SGROUND + Math.round(SCALE)) * u;
    const maxR = Math.floor(h / CH) - 1;
    const step = CH / u; // grid cells per row, so traces grow at the tree's pace
    const queue: TraceStart[] = [];
    let nextId = 0;
    // A strand ends at a root glyph with nothing of the root right below it.
    const rootAt = new Map(glyphs.filter((g) => g.root).map((g) => [g.col + "," + g.row, g]));
    const ends = [...rootAt.values()].filter((g) => ![-1, 0, 1].some((d) => rootAt.has(g.col! + d + "," + (g.row! + 1))));
    ends.sort((a, b) => a.row! - b.row! || a.col! - b.col!);
    const strands: { row: number; c0: number; c1: number; gs: Glyph[] }[] = [];
    for (const g of ends) {
      const last = strands[strands.length - 1];
      if (last && last.row === g.row && g.col! - last.c1 <= 1) { last.c1 = g.col!; last.gs.push(g); }
      else strands.push({ row: g.row!, c0: g.col!, c1: g.col!, gs: [g] });
    }
    // Each strand frays into wires: thin ones continue as one trace, thick ones split into parallel traces.
    let r0 = Infinity;
    for (const st of strands) {
      const cols: number[] = [];
      if (st.c1 - st.c0 + 1 <= 2) cols.push(Math.round((st.c0 + st.c1) / 2));
      else for (let c = st.c0; c <= st.c1; c += 2) cols.push(c);
      for (const c of cols) {
        const g = st.gs.reduce((a, b) => (Math.abs(b.col! - c) < Math.abs(a.col! - c) ? b : a));
        const lean = g.ch === "/" ? -1 : g.ch === "\\" ? 1 : Math.sign(c - c0); // keep going the way the root was going
        r0 = Math.min(r0, st.row + 1);
        queue.push({ c, r: st.row + 1, side: lean, fan: Math.min(10, Math.round(Math.abs(c - c0) / 3) + (lean ? 2 : 0)), birth: g.birth + DECODE * 0.5, depth: 0, jogFirst: 0, cutoff: 0 });
      }
    }
    if (!isFinite(r0)) r0 = Math.ceil(groundY / CH) + 1;
    const rowsTotal = Math.max(1, maxR - r0);
    // strands near the trunk run deepest; outer ones stop sooner
    for (const t of queue) t.cutoff = t.r + Math.floor((maxR - t.r) * (Math.abs(t.c - c0) < 6 ? 0.85 + R() * 0.15 : 0.35 + R() * 0.6));
    queue.sort((p, q) => q.fan - p.fan); // outermost first: they claim their diagonal before the inner ones drop
    const free = (c: number, r: number, id: number) => {
      for (let dc = -1; dc <= 1; dc++) {
        const ow = owner.get(key(c + dc, r));
        if (ow !== undefined && ow !== id) return false;
      }
      return c >= 0 && r <= maxR;
    };
    const walk = (t: TraceStart) => {
      const id = nextId++, path: TracePoint[] = [];
      let { c, r, birth } = t, fan = t.fan, jog = t.jogFirst, prev = jog ? "h" : "d";
      const side = t.side;
      const place = (ch: string) => { owner.set(key(c, r), id); path.push({ c, r, ch, birth, x: 0, y: 0 }); birth += step; };
      if (!jog && side && fan > 0) { c += side; fan--; } // carry the root's slant straight into the wire
      if (!free(c, r, id)) return;
      place(jog ? "+" : side && t.fan > 0 ? (side < 0 ? "/" : "\\") : "|");
      while (r < t.cutoff) {
        let dir: "d" | "g" | "h";
        if (jog > 0) dir = "h";
        else if (fan > 0) dir = "g";
        else if (side && R() < 0.1) { jog = 2 + Math.floor(R() * 5); dir = "h"; }
        else dir = "d";
        const nc = dir === "d" ? c : c + side, nr = dir === "h" ? r : r + 1;
        if (!free(nc, nr, id)) {
          if (dir !== "d" && free(c, r + 1, id)) { fan = 0; jog = 0; dir = "d"; } // blocked sideways: keep dropping
          else break;
        }
        if (prev !== dir && (dir === "h" || prev === "h") && path.length) path[path.length - 1].ch = "+";
        if (dir === "d") r++;
        else if (dir === "g") { r++; c += side; fan--; }
        else { c += side; jog--; }
        place(dir === "d" ? "|" : dir === "g" ? (side < 0 ? "/" : "\\") : "-");
        prev = dir;
        if (dir === "d" && t.depth < 2 && side && R() < 0.08) {
          path[path.length - 1].ch = "+"; // a side branch leaves from here to its own via
          queue.push({ c: c + side, r, side, fan: 0, birth, depth: t.depth + 1, jogFirst: 3 + Math.floor(R() * 6), cutoff: Math.min(maxR, r + 4 + Math.floor(R() * 14)) });
        }
      }
      if (free(c, r + 1, id) && r + 1 <= maxR) { r++; owner.set(key(c, r), id); path.push({ c, r, ch: R() < 0.3 ? "O" : "o", birth, via: true, x: 0, y: 0 }); }
      if (path.length > 1) traces.push(path);
    };
    while (queue.length) walk(queue.shift()!);
    for (const path of traces) for (const p of path) {
      p.x = p.c * CW; p.y = p.r * CH;
      const fade = 1 - Math.min(1, (p.r - r0) / rowsTotal) * 0.6; // fade toward the bottom of the screen
      glyphs.push({ x: p.x, y: p.y, ch: p.ch, birth: p.birth, leaf: false, n: 0, color: p.via ? AMBER : INK, alpha: (p.via ? 0.9 : p.ch === "+" ? 0.75 : 0.62) * fade });
    }
  }

  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    if (!w || !h) return;
    for (const c of [canvas, layer]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.font = FONT; lctx.textBaseline = "top";
    settled = 0; flick = [];
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1, narrow = w < 760;
    u = Math.min((h * (narrow ? 0.98 : 0.96)) / bh, (w * (narrow ? 0.95 : 0.56)) / (bw * VISIBLE));
    ox = w - (box.x0 + bw * VISIBLE) * u;
    oy = h * (narrow ? 0.7 : 0.68) - SGROUND * u; // ground at ~68% of the height: the lower third is for the roots
    glyphs = [];
    // one sample per character cell; main limbs read through the crown, twigs disappear under the foliage
    const rankOf = (c: Cell) => (c.kind === "wood" ? ((c.r ?? 0) >= 1.6 ? 4 : 1) : c.kind === "leaf" ? 2 : 3);
    const groundRow = SGROUND + Math.round(SCALE);
    const cols = Math.ceil(w / CW), rows = Math.ceil(h / CH);
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const px = col * CW, py = r * CH;
      const gx0 = Math.floor((px - ox) / u), gx1 = Math.floor((px + CW - 0.01 - ox) / u);
      const gy0 = Math.floor((py - oy) / u), gy1 = Math.floor((py + CH - 0.01 - oy) / u);
      if (gx1 < 0 || gy1 < 0 || gx0 >= SW || gy0 >= SH) continue;
      let best: Cell | null = null;
      for (let gx = Math.max(0, gx0); gx <= Math.min(SW - 1, gx1); gx++) for (let gy = gy0; gy <= gy1; gy++) {
        const c = map.get(gx + gy * SW);
        if (c && (c.kind !== "root" || c.y <= SGROUND + ROOT_BAND) && (!best || rankOf(c) > rankOf(best))) best = c;
      }
      const n = hash(col, r);
      if (best) {
        let color = INK, alpha: number;
        if (best.kind === "leaf") {
          const dn = best.dn ?? 1;
          alpha = dn < 0.45 ? 0.95 : dn < 0.75 ? 0.78 : dn < 0.92 ? 0.58 : 0.4;
          color = n > 0.9 ? AMBER : n > 0.84 ? FLAME : INK;
        } else alpha = best.kind === "root" ? 0.85 - 0.3 * Math.min(1, (best.y - SGROUND) / ROOT_BAND) : 0.92;
        glyphs.push({ x: px, y: py, ch: glyphFor(best, n), color, alpha, birth: best.birth, leaf: best.kind === "leaf", n, root: best.kind === "root", col, row: r });
      } else if (gy0 <= groundRow && gy1 >= groundRow) {
        const dist = Math.abs((px - ox) / u - SCX); // ragged ground line reaching out from the trunk
        if (dist < (box.x1 - box.x0) * 0.62 && n > 0.25) glyphs.push({ x: px, y: py, ch: n > 0.85 ? "." : n > 0.7 ? "," : "_", color: INK, alpha: 0.22, birth: dist * 0.9, leaf: false, n });
      }
    }
    // Keep only root pieces connected to the trunk; deeper roots poking into the band would float.
    const roots = glyphs.filter((g) => g.root);
    if (roots.length) {
      const at = new Map(roots.map((g) => [g.col + "," + g.row, g]));
      const top = Math.min(...roots.map((g) => g.row!)), cTrunk = (ox + SCX * u) / CW;
      const seen = new Set<Glyph>(), stack = roots.filter((g) => g.row! <= top + 1 && Math.abs(g.col! - cTrunk) < 14);
      stack.forEach((g) => seen.add(g));
      while (stack.length) {
        const g = stack.pop()!;
        for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
          const nb = at.get(g.col! + dc + "," + (g.row! + dr));
          if (nb && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
      }
      glyphs = glyphs.filter((g) => !g.root || (seen.has(g) && g.ch !== "_" && g.ch !== "-"));
    }
    buildCircuit();
    glyphs.sort((a, b) => a.birth - b.birth);
    // one realm per step, on visible crown tips
    const visMax = box.x0 + (box.x1 - box.x0) * VISIBLE - 4 * SCALE;
    const crown = tips.filter((tp) => !tp.mid && tp.x < visMax).sort((a, b) => a.x - b.x);
    const prev = orbs;
    orbs = crown.length
      ? Array.from({ length: opts.realms }, (_, i) => crown[Math.floor(((i + 0.5) * crown.length) / opts.realms)]).map((o, i) => ({
          x: Math.floor((ox + o.x * u) / CW) * CW,
          y: Math.floor((oy + o.y * u) / CH) * CH,
          on: prev[i]?.on ?? 0,
          yy: o.y,
        }))
      : [];
    orbs.sort((a, b) => b.yy - a.yy || a.x - b.x);
  }

  const paint = (c: CanvasRenderingContext2D, e: Glyph, ch: string, alpha: number) => {
    c.fillStyle = `rgba(${e.color},${alpha})`;
    c.fillText(ch, e.x, e.y);
  };

  function frame(now: number) {
    if (disposed) return;
    // Growth clock: accumulated so hurry() can speed it up mid-way.
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    gAcc += dt * SPEED * rate;
    const g = reduce ? 1e9 : gAcc, sec = now / 1000;
    while (settled < glyphs.length && glyphs[settled].birth + DECODE <= g) {
      const e = glyphs[settled++];
      paint(lctx, e, e.ch, e.alpha);
    }
    // wind: a few leaf glyphs flicker on the static layer, then restore
    if (!reduce && settled > 0) {
      flick = flick.filter((f) => {
        if (now < f.until) return true;
        lctx.clearRect(f.e.x, f.e.y, CW, CH);
        paint(lctx, f.e, f.e.ch, f.e.alpha);
        return false;
      });
      for (let k = 0; k < 4; k++) {
        const e = glyphs[Math.floor(Math.random() * settled)];
        if (e && e.leaf) {
          lctx.clearRect(e.x, e.y, CW, CH);
          paint(lctx, e, e.n > 0.5 ? "*" : "'", e.alpha);
          flick.push({ e, until: now + 300 + Math.random() * 500 });
        }
      }
    }
    ctx.clearRect(0, 0, w, h);
    const lightUp = Math.max(0, Math.min(1, g / (140 * SCALE)));
    {
      const gx = ox + SCX * u, gy = oy + (box.y0 + (SGROUND - box.y0) * 0.45) * u, gr = (box.x1 - box.x0) * u * 0.6;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      grad.addColorStop(0, `rgba(${FLAME},${0.14 * lightUp})`);
      grad.addColorStop(1, `rgba(${FLAME},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    ctx.drawImage(layer, 0, 0, w, h);
    ctx.font = FONT;
    ctx.textBaseline = "top";
    for (let i = settled; i < glyphs.length; i++) {
      const e = glyphs[i];
      if (e.birth > g) break;
      ctx.fillStyle = `rgba(${AMBER},${0.5 + (g - e.birth) / DECODE / 2})`; // decoding: random characters first
      ctx.fillText(SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)], e.x, e.y);
    }
    if (g > 120 * SCALE) orbs.forEach((o, i) => {
      const on = i < lit ? 1 : i === lit ? 0.55 + 0.45 * Math.sin(sec * 3) : 0;
      o.on += (on - o.on) * 0.08;
      if (o.on < 0.02) return;
      const cx = o.x + CW / 2, cy = o.y + CH / 2, r = 12 + o.on * 14;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(240,160,110,${0.6 * o.on})`);
      grad.addColorStop(1, "rgba(240,160,110,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      if (o.on > 0.3) {
        ctx.fillStyle = "#ffe7c4";
        ctx.font = ORB_FONT;
        ctx.fillText("*", o.x - 2, o.y - 3);
        ctx.font = FONT;
      }
    });
    if (!reduce && g > 160 * SCALE && Math.random() < (bloomAt && now - bloomAt < 2500 ? 0.8 : 0.08)) {
      const src = glyphs[Math.floor(Math.random() * glyphs.length)];
      if (src && src.leaf) particles.push({ x: src.x, y: src.y, vx: -0.2 - Math.random() * 0.3, vy: 0.25 + Math.random() * 0.3, ch: ".'`,"[Math.floor(Math.random() * 4)], life: 1 });
    }
    const groundY = oy + SGROUND * u;
    particles = particles.filter((p) => p.y < groundY && (p.life -= 0.003) > 0);
    for (const p of particles) {
      p.x += p.vx + Math.sin(sec * 2 + p.y * 0.05) * 0.25;
      p.y += p.vy;
      ctx.fillStyle = `rgba(${INK},${Math.min(0.7, p.life)})`;
      ctx.fillText(p.ch, p.x, p.y);
    }
    // signals: amber pulses run down the traces and light the via they reach
    if (!reduce && g > 140 * SCALE && traces.length && Math.random() < 0.07)
      pulses.push({ path: traces[Math.floor(Math.random() * traces.length)], i: 0, v: 0.25 + Math.random() * 0.25 });
    pulses = pulses.filter((pl) => {
      pl.i += pl.v;
      const n = pl.path.length, head = Math.floor(pl.i);
      if (head >= n + 6) return false;
      for (let k = 0; k < 4; k++) {
        const j = head - k;
        if (j < 0 || j >= n) continue;
        const p = pl.path[j];
        ctx.fillStyle = `rgba(255,214,160,${(1 - k / 4) * (p.via ? 1 : 0.95)})`;
        ctx.fillText(p.ch, p.x, p.y);
      }
      if (head >= n - 1) {
        const p = pl.path[n - 1], a = Math.max(0, 1 - (pl.i - (n - 1)) / 6), cx = p.x + CW / 2, cy = p.y + CH / 2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
        grad.addColorStop(0, `rgba(240,160,110,${0.55 * a})`);
        grad.addColorStop(1, "rgba(240,160,110,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(cx - 14, cy - 14, 28, 28);
      }
      return true;
    });
    raf = requestAnimationFrame(frame);
  }

  const start = () => {
    if (disposed) return;
    cancelAnimationFrame(raf);
    particles = [];
    pulses = [];
    fit();
    orbs.forEach((o) => (o.on = 0));
    gAcc = 0;
    last = 0;
    rate = 1;
    raf = requestAnimationFrame(frame);
  };

  // The canvas text needs the bundled mono face loaded and measured first, or the grid is laid out for a fallback.
  const fontReady = document.fonts.load(FONT).then(() => {
    ctx.font = FONT;
    const m = ctx.measureText("M").width;
    if (m > 0) CW = m;
    CH = FONT_PX * 1.08;
    ready = true;
  }).catch(() => { ready = true; });

  const ro = new ResizeObserver(() => {
    if (!ready || disposed) return;
    fit(); // re-lay the glyph grid; growth keeps its clock, settled glyphs repaint at once
  });
  ro.observe(canvas);

  return {
    restart() { void fontReady.then(start); },
    setLit(i) { lit = i; },
    bloom() { lit = opts.realms; bloomAt = performance.now(); },
    hurry() { rate = 7; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
