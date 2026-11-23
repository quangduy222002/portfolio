/**
 * The technical drawing set made from the plan before it is built in 3D, for checking against the client's drawing:
 * each floor drawn the way an architect's permit plan is (structural grid with numbered and lettered axes, three
 * dimension chains on every side, columns, walls in poché, doors with their swings, windows, stairs with their
 * treads, room names with areas, floor levels, north arrow and a title block), and a schematic section with floor
 * levels and heights. The client's own drawing can be laid underneath to compare.
 * Pure geometry to SVG, no three.js; units in the SVG are centimetres (1 unit = 1 cm, so 1:100 is 1 unit per mm).
 */
import { FURNITURE } from './catalog';
import { linework, type Arc, type Seg } from './export';
import {
  isFloorArea,
  OPEN_ROOM,
  OUTSIDE_ROOM,
  PARAPET,
  PLINTH,
  SHAFT_ROOM,
  SLAB,
  storeyHeight,
  storeysOf,
  type Item,
  type Plan,
  type Vec2,
} from './plan';

/** The client's drawing laid under a floor, placed in plan metres. */
export interface Underlay {
  /** A raster of the sheet and where its corners land on the plan. */
  image?: { href: string; x0: number; z0: number; x1: number; z1: number };
  /** Or the sheet's linework, as segments in plan metres. */
  segs?: Seg[];
}

const INK = '#111827';
const THIN = '#4b5563';
const DIM = '#1f2937';
const AXIS = '#b42318';
/** Text and symbol scale for the sheet being drawn: larger on a large building, so it reads at screen size. */
let TS = 1;
const fs = (n: number) => f1(n * TS);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
/** Plan metres to SVG units (cm). */
const U = (m: number) => m * 100;
const P = (q: Vec2) => `${f1(U(q[0]))},${f1(U(q[1]))}`;
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];

/** A level as drawings write it: ±0.000, +3.300, -0.200 (metres, three decimals). */
export const levelText = (m: number) =>
  Math.abs(m) < 0.0005 ? '±0.000' : `${m > 0 ? '+' : '-'}${Math.abs(m).toFixed(3)}`;

/** Groups values closer than `tol` and returns each group's mean, sorted. */
function cluster(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1]! <= tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

const dedupe = (values: number[], tol = 0.015) => cluster(values, tol);

const isColumn = (it: Item) => !!FURNITURE[it.type]?.fullHeight;
const isStair = (it: Item) => /^stairs/.test(it.type);

/** Turns an item's local point (x right, z toward its front) into plan metres. */
function placer(it: Item) {
  const r = (it.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m = it.mirror ? -1 : 1;
  return ([x, z]: Vec2): Vec2 => [it.x + m * x * c - z * s, it.z + m * x * s + z * c];
}

/** Stair linework (outline, treads, walking line with its arrow) in plan metres. */
function stairLines(it: Item): { outline: Vec2[]; treads: Seg[]; walk: Vec2[] } {
  const def = FURNITURE[it.type]!;
  const at = placer(it);
  const w = def.w;
  const d = def.d;
  const outline = (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as Vec2[]
  ).map(at);
  const treads: Seg[] = [];
  const across = (x0: number, x1: number, z: number) => treads.push([at([x0, z]), at([x1, z])]);
  const along = (z0: number, z1: number, x: number) => treads.push([at([x, z0]), at([x, z1])]);
  const steps = (a: number, b: number, n: number) =>
    Array.from({ length: n - 1 }, (_, i) => a + ((b - a) * (i + 1)) / n);
  let walk: Vec2[];
  if (/^stairsSpiral/.test(it.type)) {
    const R = w / 2;
    const core = Math.max(0.08, R * 0.12);
    const steps = Math.max(4, Math.round(def.h / 0.19));
    const turn = Math.min((24 * Math.PI) / 180, (330 * Math.PI) / 180 / steps);
    const circle = (r: number) =>
      Array.from({ length: 33 }, (_, i) =>
        at([Math.sin((i / 32) * Math.PI * 2) * r, Math.cos((i / 32) * Math.PI * 2) * r]),
      );
    const rim = circle(R);
    for (let i = 0; i < 32; i++) treads.push([rim[i]!, rim[i + 1]!]);
    const hub = circle(core);
    for (let i = 0; i < 32; i++) treads.push([hub[i]!, hub[i + 1]!]);
    for (let i = 0; i <= steps; i++) {
      const a = i * turn;
      treads.push([at([Math.sin(a) * core, Math.cos(a) * core]), at([Math.sin(a) * R, Math.cos(a) * R])]);
    }
    const mid = (R + core) / 2;
    walk = Array.from({ length: 17 }, (_, i) => {
      const a = 0.3 * turn + ((steps - 0.6) * turn * i) / 16;
      return at([Math.sin(a) * mid, Math.cos(a) * mid]);
    });
    return { outline: [], treads, walk };
  }
  if (it.type === 'stairsU') {
    const landing = Math.min(1.1, d / 3);
    const back = -d / 2 + landing;
    for (const z of steps(d / 2, back, 9)) across(-w / 2, 0, z);
    for (const z of steps(back, d / 2, 9)) across(0, w / 2, z);
    treads.push([at([-w / 2, back]), at([w / 2, back])], [at([0, back]), at([0, d / 2])]);
    walk = (
      [
        [-w / 4, d / 2 - 0.1],
        [-w / 4, back - landing / 2],
        [w / 4, back - landing / 2],
        [w / 4, d / 2 - 0.1],
      ] as Vec2[]
    ).map(at);
  } else if (it.type === 'stairsL') {
    const run = 1.0;
    const corner = -d / 2 + run;
    for (const z of steps(d / 2, corner, 8)) across(-w / 2, -w / 2 + run, z);
    for (const x of steps(-w / 2 + run, w / 2, 8)) along(-d / 2, corner, x);
    treads.push(
      [at([-w / 2, corner]), at([-w / 2 + run, corner])],
      [at([-w / 2 + run, -d / 2]), at([-w / 2 + run, corner])],
    );
    walk = (
      [
        [-w / 2 + run / 2, d / 2 - 0.1],
        [-w / 2 + run / 2, -d / 2 + run / 2],
        [w / 2 - 0.1, -d / 2 + run / 2],
      ] as Vec2[]
    ).map(at);
  } else {
    const n = Math.max(4, Math.round(d / 0.27));
    for (const z of steps(d / 2, -d / 2, n)) across(-w / 2, w / 2, z);
    walk = (
      [
        [0, d / 2 - 0.1],
        [0, -d / 2 + 0.1],
      ] as Vec2[]
    ).map(at);
  }
  return { outline, treads, walk };
}

interface Chain {
  /** Positions along the side (x for top and bottom, z for left and right), in metres. */
  marks: number[];
}

export interface SheetOptions {
  title: string;
  /** Finished floor level, metres above the ground floor. */
  level: number;
  /** Floor-to-floor height, for the title block. */
  height: number;
  ground: boolean;
  underlay?: Underlay;
  /** Draws the furniture outlines too (light), not only the building. */
  furniture?: boolean;
}

/** One floor as a technical plan (SVG). */
export function floorSheet(p: Plan, o: SheetOptions): string {
  const d = linework(p);
  const empty = !Number.isFinite(d.bounds.x0);
  const B = empty ? { x0: 0, z0: 0, x1: 6, z1: 4 } : d.bounds;
  TS = Math.min(3, Math.max(1, Math.max(B.x1 - B.x0, B.z1 - B.z0) / 8));
  const columns = p.items.filter(isColumn);
  const stairs = p.items.filter((it) => isStair(it) && FURNITURE[it.type]);
  const others = p.items.filter((it) => !isColumn(it) && !isStair(it) && FURNITURE[it.type] && it.type !== 'void');

  // Structural grid: through the columns, and the outer walls' centre lines.
  const nodes = p.nodes;
  const nx = nodes.map((n) => n.x);
  const nz = nodes.map((n) => n.z);
  const edgeX = nodes.length ? [Math.min(...nx), Math.max(...nx)] : [B.x0, B.x1];
  const edgeZ = nodes.length ? [Math.min(...nz), Math.max(...nz)] : [B.z0, B.z1];
  const axesX = cluster([...columns.map((c) => c.x), ...edgeX], 0.5);
  const axesZ = cluster([...columns.map((c) => c.z), ...edgeZ], 0.5);

  // Dimension chains, from the wall outward: openings and piers on that facade, axis to axis, overall.
  const wallsOn = (side: 'top' | 'bottom' | 'left' | 'right') => {
    const map = new Map(p.nodes.map((n) => [n.id, n]));
    const marks: number[] = [];
    const horiz = side === 'top' || side === 'bottom';
    const edge = side === 'top' ? edgeZ[0]! : side === 'bottom' ? edgeZ[1]! : side === 'left' ? edgeX[0]! : edgeX[1]!;
    for (const w of p.walls) {
      const a = map.get(w.a);
      const b = map.get(w.b);
      if (!a || !b) continue;
      const ca = horiz ? a.z : a.x;
      const cb = horiz ? b.z : b.x;
      if (Math.abs(ca - edge) > 0.35 || Math.abs(cb - edge) > 0.35) continue;
      // Only straight walls along this side: the pieces of a curved wall would crowd the chain with tiny figures.
      if (Math.abs(ca - cb) > 0.02) continue;
      const pa = horiz ? a.x : a.z;
      const pb = horiz ? b.x : b.z;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.05) continue;
      const half = w.thick / 2;
      marks.push(Math.min(pa, pb) - half, Math.max(pa, pb) + half);
      for (const op of p.openings.filter((q) => q.wall === w.id)) {
        const c = pa + (pb - pa) * op.t;
        marks.push(c - op.width / 2, c + op.width / 2);
      }
    }
    return marks;
  };
  const chainsFor = (side: 'top' | 'bottom' | 'left' | 'right'): Chain[] => {
    const horiz = side === 'top' || side === 'bottom';
    const lo = horiz ? B.x0 : B.z0;
    const hi = horiz ? B.x1 : B.z1;
    // Marks closer than 12 cm (a jamb beside a column) merge, so no figure is squeezed unreadably small.
    const detail = dedupe(
      wallsOn(side).filter((v) => v >= lo - 0.01 && v <= hi + 0.01),
      0.12,
    );
    const axes = horiz ? axesX : axesZ;
    const out: Chain[] = [];
    if (detail.length > 2) out.push({ marks: detail });
    if (axes.length > 1) out.push({ marks: axes });
    out.push({ marks: [lo, hi] });
    return out;
  };

  const GAP = 0.55; // between the wall and the first chain, and between chains (metres)
  const AXS = Math.min(TS, 1.6);
  const AX = 0.6 * AXS; // the axis bubbles sit beyond the chains
  const chains = {
    top: chainsFor('top'),
    bottom: chainsFor('bottom'),
    left: chainsFor('left'),
    right: chainsFor('right'),
  };
  const reach = (n: number) => GAP * (n + 1) + AX + 0.35;
  const left = B.x0 - reach(chains.left.length);
  const right = B.x1 + reach(chains.right.length);
  const top = B.z0 - reach(chains.top.length);
  const titleH = 1.1 * TS;
  const bottom = B.z1 + reach(chains.bottom.length) + titleH;
  const o2: string[] = [];
  const vw = U(right - left);
  const vh = U(bottom - top);
  o2.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="tech-sheet" viewBox="${f1(U(left))} ${f1(U(top))} ${f1(vw)} ${f1(vh)}" width="${Math.round(vw * 2)}" height="${Math.round(vh * 2)}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">`,
    `<rect x="${f1(U(left))}" y="${f1(U(top))}" width="${f1(vw)}" height="${f1(vh)}" fill="#ffffff"/>`,
  );

  // The client's drawing underneath (its opacity is set by the page), cut off at the sheet's edge.
  o2.push(
    `<clipPath id="sheetClip"><rect x="${f1(U(left))}" y="${f1(U(top))}" width="${f1(vw)}" height="${f1(vh)}"/></clipPath>`,
  );
  if (o.underlay?.image) {
    const { href, x0, z0, x1, z1 } = o.underlay.image;
    o2.push(
      `<image class="tech-under" clip-path="url(#sheetClip)" href="${esc(href)}" x="${f1(U(x0))}" y="${f1(U(z0))}" width="${f1(U(x1 - x0))}" height="${f1(U(z1 - z0))}" preserveAspectRatio="none"/>`,
    );
  } else if (o.underlay?.segs?.length) {
    o2.push(
      `<path class="tech-under" clip-path="url(#sheetClip)" d="${o.underlay.segs.map(([a, b]) => `M${P(a)}L${P(b)}`).join('')}" stroke="#2563eb" stroke-width="0.8" fill="none"/>`,
    );
  }
  o2.push('<g class="tech-ink">');

  // Grid lines (thin dash-dot) under everything else.
  const gridDash = 'stroke-dasharray="24 5 3 5"';
  const zA = top + AX - 0.05;
  const zB = bottom - titleH - AX + 0.05;
  const xA = left + AX - 0.05;
  const xB = right - AX + 0.05;
  for (const x of axesX)
    o2.push(
      `<line x1="${f1(U(x))}" y1="${f1(U(zA))}" x2="${f1(U(x))}" y2="${f1(U(zB))}" stroke="${AXIS}" stroke-width="0.6" ${gridDash}/>`,
    );
  for (const z of axesZ)
    o2.push(
      `<line x1="${f1(U(xA))}" y1="${f1(U(z))}" x2="${f1(U(xB))}" y2="${f1(U(z))}" stroke="${AXIS}" stroke-width="0.6" ${gridDash}/>`,
    );

  // Rooms: a light tint; balconies and terraces hatched as outdoor floor.
  for (const { room, name } of d.rooms)
    o2.push(`<polygon points="${room.poly.map(P).join(' ')}" fill="${OPEN_ROOM.test(name) ? '#eef4fb' : '#fafafa'}"/>`);
  if (o.furniture)
    for (const it of others) {
      const def = FURNITURE[it.type]!;
      const at = placer(it);
      const pts = (
        [
          [-def.w / 2, -def.d / 2],
          [def.w / 2, -def.d / 2],
          [def.w / 2, def.d / 2],
          [-def.w / 2, def.d / 2],
        ] as Vec2[]
      ).map(at);
      o2.push(`<polygon points="${pts.map(P).join(' ')}" fill="none" stroke="#9ca3af" stroke-width="0.6"/>`);
    }

  // Stairs: outline, treads, and the walking line with an arrow pointing up the flight.
  for (const it of stairs) {
    const s = stairLines(it);
    o2.push(
      `<polygon points="${s.outline.map(P).join(' ')}" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`,
      `<path d="${s.treads.map(([a, b]) => `M${P(a)}L${P(b)}`).join('')}" stroke="${THIN}" stroke-width="0.6" fill="none"/>`,
      `<polyline points="${s.walk.map(P).join(' ')}" fill="none" stroke="${INK}" stroke-width="0.8"/>`,
    );
    const [a, b] = [s.walk[s.walk.length - 2]!, s.walk[s.walk.length - 1]!];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n: Vec2 = [-u[1], u[0]];
    const head = [add(add(b, u, -0.18), n, 0.07), b, add(add(b, u, -0.18), n, -0.07)];
    o2.push(`<polyline points="${head.map(P).join(' ')}" fill="none" stroke="${INK}" stroke-width="0.8"/>`);
    const s0 = s.walk[0]!;
    o2.push(
      `<circle cx="${f1(U(s0[0]))}" cy="${f1(U(s0[1]))}" r="4" fill="#ffffff" stroke="${INK}" stroke-width="0.8"/>`,
      `<text x="${f1(U(s0[0]))}" y="${f1(U(s0[1]) + 16)}" font-size="${fs(9)}" text-anchor="middle" fill="${INK}">UP</text>`,
    );
  }

  // Railings, walls (poché), glazing, doors with their swings.
  for (const r of d.rails)
    o2.push(`<polygon points="${r.map(P).join(' ')}" fill="#ffffff" stroke="${INK}" stroke-width="0.6"/>`);
  o2.push(`<path d="${d.railLines.map(seg).join('')}" stroke="${INK}" stroke-width="0.6" fill="none"/>`);
  for (const w of d.walls)
    o2.push(`<polygon points="${w.map(P).join(' ')}" fill="#374151" stroke="#374151" stroke-width="0.3"/>`);
  o2.push(`<path d="${d.wallLines.map(seg).join('')}" stroke="${INK}" stroke-width="1.4" fill="none"/>`);
  o2.push(`<path d="${d.glazing.map(seg).join('')}" stroke="${INK}" stroke-width="0.7" fill="none"/>`);
  o2.push(`<path d="${d.doors.map(seg).join('')}" stroke="${INK}" stroke-width="1.2" fill="none"/>`);
  o2.push(`<path d="${d.arcs.map(arc).join('')}" stroke="${THIN}" stroke-width="0.6" fill="none"/>`);

  // Columns: solid, as reinforced concrete is drawn in section.
  for (const c of columns) {
    const def = FURNITURE[c.type]!;
    const at = placer(c);
    const pts = (
      [
        [-def.w / 2, -def.d / 2],
        [def.w / 2, -def.d / 2],
        [def.w / 2, def.d / 2],
        [-def.w / 2, def.d / 2],
      ] as Vec2[]
    ).map(at);
    o2.push(`<polygon points="${pts.map(P).join(' ')}" fill="${INK}" stroke="${INK}" stroke-width="1"/>`);
  }

  // Room names, areas, and the floor level in each room. A shaft is crossed out (a void through the floors, no
  // area); the yard is outside the building, at yard level.
  for (const { room, name } of d.rooms) {
    const [cx, cz] = room.centroid;
    if (SHAFT_ROOM.test(name)) {
      const xs = room.poly.map((q) => q[0]);
      const zs = room.poly.map((q) => q[1]);
      const [a, b] = [Math.min(...xs), Math.max(...xs)];
      const [c, e] = [Math.min(...zs), Math.max(...zs)];
      o2.push(`<path d="M${P([a, c])}L${P([b, e])}M${P([b, c])}L${P([a, e])}" stroke="${THIN}" stroke-width="0.6"/>`);
      continue;
    }
    const small = room.area < 3;
    const yard = OUTSIDE_ROOM.test(name);
    o2.push(
      `<text x="${f1(U(cx))}" y="${f1(U(cz) - 6)}" font-size="${fs(small ? 9 : 13)}" font-weight="600" fill="${INK}" text-anchor="middle">${esc(name.toUpperCase())}</text>`,
      `<text x="${f1(U(cx))}" y="${f1(U(cz) + 8 * TS)}" font-size="${fs(small ? 8 : 10)}" fill="${THIN}" text-anchor="middle">${yard ? 'not built · ' : ''}S = ${room.area.toFixed(1)} m²</text>`,
    );
    const level = yard && o.ground ? -PLINTH : o.level - (OPEN_ROOM.test(name) ? 0.05 : 0);
    if (!small) o2.push(levelMark(cx, cz + 0.32 * TS, level));
  }
  if (o.ground) o2.push(levelMark(B.x0 + 0.25, B.z1 + 0.25, -PLINTH));

  // Dimension chains and axis bubbles on all four sides.
  const sides = ['top', 'bottom', 'left', 'right'] as const;
  for (const side of sides) {
    const horiz = side === 'top' || side === 'bottom';
    const sign = side === 'top' || side === 'left' ? -1 : 1;
    const face = side === 'top' ? B.z0 : side === 'bottom' ? B.z1 : side === 'left' ? B.x0 : B.x1;
    chains[side].forEach((ch, i) => {
      const at = face + sign * GAP * (i + 1);
      o2.push(dimChain(ch.marks, at, horiz, face + sign * 0.12, sign));
    });
    const bubble = face + sign * (GAP * (chains[side].length + 1) + AX / 2);
    const axes = horiz ? axesX : axesZ;
    axes.forEach((v, i) => {
      const label = horiz ? String(i + 1) : axisLetter(i);
      const [x, z] = horiz ? [v, bubble] : [bubble, v];
      o2.push(
        `<circle cx="${f1(U(x))}" cy="${f1(U(z))}" r="${f1(U(0.2 * AXS))}" fill="#ffffff" stroke="${AXIS}" stroke-width="0.8"/>`,
        `<text x="${f1(U(x))}" y="${f1(U(z) + 4.5 * AXS)}" font-size="${f1(13 * AXS)}" font-weight="600" text-anchor="middle" fill="${AXIS}">${label}</text>`,
      );
    });
  }
  o2.push('</g>');

  // Title block: name, level, floor height, scale; north arrow and a scale bar.
  const tb = bottom - titleH + 0.2;
  const counted = d.rooms.filter((r) => isFloorArea(r.name));
  const area = counted.reduce((s, r) => s + r.room.area, 0);
  o2.push(
    `<line x1="${f1(U(left + 0.3))}" y1="${f1(U(tb - 0.12))}" x2="${f1(U(right - 0.3))}" y2="${f1(U(tb - 0.12))}" stroke="${INK}" stroke-width="0.8"/>`,
    `<text x="${f1(U(left + 0.3))}" y="${f1(U(tb + 0.22 * TS))}" font-size="${fs(20)}" font-weight="700" fill="${INK}">${esc(o.title.toUpperCase())}</text>`,
    `<text x="${f1(U(left + 0.3))}" y="${f1(U(tb + 0.5 * TS))}" font-size="${fs(11)}" fill="${THIN}">Level ${levelText(o.level)} · floor to floor ${(o.height * 1000).toFixed(0)} mm · ${counted.length} rooms · ${area.toFixed(1)} m² net · scale 1:100 · dimensions in mm</text>`,
  );
  const bar = right - 0.6 - TS;
  o2.push(
    `<rect x="${f1(U(bar))}" y="${f1(U(tb + 0.3))}" width="50" height="5" fill="${INK}"/>`,
    `<rect x="${f1(U(bar) + 50)}" y="${f1(U(tb + 0.3))}" width="50" height="5" fill="#ffffff" stroke="${INK}" stroke-width="0.8"/>`,
    `<text x="${f1(U(bar))}" y="${f1(U(tb + 0.5 * TS))}" font-size="${fs(9)}" fill="${THIN}">0</text>`,
    `<text x="${f1(U(bar) + 100)}" y="${f1(U(tb + 0.5 * TS))}" font-size="${fs(9)}" fill="${THIN}" text-anchor="end">1 m</text>`,
  );
  const nX = U(bar - 0.3 - 0.25 * TS);
  const nZ = U(tb + 0.22 * TS);
  o2.push(
    `<g transform="translate(${f1(nX)} ${f1(nZ)}) rotate(${f1(p.north ?? 0)}) scale(${f1(TS)})"><circle r="18" fill="none" stroke="${INK}" stroke-width="0.8"/><path d="M0,-16L7,10L0,5L-7,10Z" fill="${INK}"/><text y="-21" font-size="10" font-weight="700" text-anchor="middle" fill="${INK}">N</text></g>`,
  );
  o2.push('</svg>');
  return o2.join('\n');
}

const seg = ([a, b]: Seg) => `M${P(a)}L${P(b)}`;
function arc(a: Arc) {
  const p0 = add(a.c, a.from, a.r);
  const p1 = add(a.c, a.to, a.r);
  const sweep = a.from[0] * a.to[1] - a.from[1] * a.to[0] > 0 ? 1 : 0;
  return `M${P(p0)}A${f1(U(a.r))},${f1(U(a.r))} 0 0 ${sweep} ${P(p1)}`;
}

/** A, B, C … skipping I and O (as grids are lettered), then AA, AB … */
function axisLetter(i: number): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return i < L.length ? L[i]! : L[Math.floor(i / L.length) - 1]! + L[i % L.length]!;
}

/** A level mark: an open triangle on a short line, with the level written beside it. */
function levelMark(x: number, z: number, level: number) {
  return `<g class="level" transform="translate(${f1(U(x))} ${f1(U(z))}) scale(${f1(TS)})"><path d="M-6,-8L6,-8L0,0Z" fill="none" stroke="${INK}" stroke-width="0.7"/><line x1="-10" y1="0" x2="42" y2="0" stroke="${INK}" stroke-width="0.7"/><text x="8" y="-3" font-size="9" fill="${INK}">${levelText(level)}</text></g>`;
}

/**
 * A dimension chain along x (horiz) or z at `at`: the dimension line, extension lines back to `from`, a 45° tick at
 * each mark and each length in millimetres over its stretch.
 */
function dimChain(marks: number[], at: number, horiz: boolean, from: number, sign: number) {
  const m = dedupe(marks);
  if (m.length < 2) return '';
  const pt = (v: number, c: number): Vec2 => (horiz ? [v, c] : [c, v]);
  const out: string[] = [];
  const a = pt(m[0]!, at);
  const b = pt(m[m.length - 1]!, at);
  out.push(
    `<line x1="${f1(U(a[0]))}" y1="${f1(U(a[1]))}" x2="${f1(U(b[0]))}" y2="${f1(U(b[1]))}" stroke="${DIM}" stroke-width="0.5"/>`,
  );
  for (const v of m) {
    const e0 = pt(v, from);
    const e1 = pt(v, at + sign * 0.08);
    out.push(
      `<line x1="${f1(U(e0[0]))}" y1="${f1(U(e0[1]))}" x2="${f1(U(e1[0]))}" y2="${f1(U(e1[1]))}" stroke="${DIM}" stroke-width="0.35"/>`,
    );
    const c = pt(v, at);
    out.push(
      `<line x1="${f1(U(c[0]) - 4)}" y1="${f1(U(c[1]) + 4)}" x2="${f1(U(c[0]) + 4)}" y2="${f1(U(c[1]) - 4)}" stroke="${DIM}" stroke-width="1.1"/>`,
    );
  }
  for (let i = 0; i + 1 < m.length; i++) {
    const len = m[i + 1]! - m[i]!;
    const mm = Math.round(len * 1000);
    if (mm < 1) continue;
    const mid = pt((m[i]! + m[i + 1]!) / 2, at);
    const narrow = len < 0.36;
    const size = narrow ? 7 : 9;
    const X = U(mid[0]);
    const Z = U(mid[1]);
    out.push(
      horiz
        ? `<text x="${f1(X)}" y="${f1(Z - 3)}" font-size="${fs(size)}" text-anchor="middle" fill="${DIM}">${mm}</text>`
        : `<text transform="translate(${f1(X - 3)} ${f1(Z)}) rotate(-90)" font-size="${fs(size)}" text-anchor="middle" fill="${DIM}">${mm}</text>`,
    );
  }
  return out.join('');
}

/**
 * A schematic section through the house (looking north): ground and plinth, each floor's slab at its level, the outer
 * walls, the roof slab with its parapet; floor-to-floor heights dimensioned on the left and levels on the right.
 */
export function sectionSheet(p: Plan, title = 'Section A–A (schematic)'): string {
  const floors = storeysOf(p).map((f, i) => ({ ...f, height: storeyHeight(p, i), lw: linework(f.plan) }));
  const spans = floors.map((f) => (Number.isFinite(f.lw.bounds.x0) ? f.lw.bounds : null));
  const known = spans.filter((s): s is NonNullable<typeof s> => !!s);
  const x0 = known.length ? Math.min(...known.map((s) => s.x0)) : 0;
  const x1 = known.length ? Math.max(...known.map((s) => s.x1)) : 6;
  const topFloor = floors[floors.length - 1]!;
  const roof = topFloor.storey.elevation + topFloor.height;
  TS = Math.min(4, Math.max(1, Math.max(x1 - x0, roof) / 5));
  const Y = (level: number) => -level; // up is up
  const left = x0 - 2.6 * TS;
  const right = x1 + 2.4 * TS;
  const top = Y(roof + PARAPET) - 0.8 * TS;
  const bottom = Y(-PLINTH) + 1.6 * TS;
  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="tech-sheet" viewBox="${f1(U(left))} ${f1(U(top))} ${f1(U(right - left))} ${f1(U(bottom - top))}" width="${Math.round(U(right - left) * 2)}" height="${Math.round(U(bottom - top) * 2)}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">`,
    `<rect x="${f1(U(left))}" y="${f1(U(top))}" width="${f1(U(right - left))}" height="${f1(U(bottom - top))}" fill="#ffffff"/>`,
  );
  const rect = (ax: number, ay: number, bx: number, by: number, fill: string) =>
    `<rect x="${f1(U(Math.min(ax, bx)))}" y="${f1(U(Math.min(ay, by)))}" width="${f1(U(Math.abs(bx - ax)))}" height="${f1(U(Math.abs(by - ay)))}" fill="${fill}" stroke="${INK}" stroke-width="0.8"/>`;
  // Ground: the yard at -PLINTH, hatched earth under it.
  o.push(
    `<line x1="${f1(U(left + 0.3))}" y1="${f1(U(Y(-PLINTH)))}" x2="${f1(U(right - 0.3))}" y2="${f1(U(Y(-PLINTH)))}" stroke="${INK}" stroke-width="1.6"/>`,
  );
  for (let x = left + 0.4; x < right - 0.4; x += 0.25)
    o.push(
      `<line x1="${f1(U(x))}" y1="${f1(U(Y(-PLINTH)))}" x2="${f1(U(x - 0.15))}" y2="${f1(U(Y(-PLINTH) + 0.15))}" stroke="${THIN}" stroke-width="0.4"/>`,
    );
  o.push(rect(x0, Y(-PLINTH), x1, Y(0), '#d1d5db'));
  const wallT = 0.2;
  floors.forEach((f, i) => {
    const s = spans[i] ?? { x0, x1 };
    const lv = f.storey.elevation;
    if (i > 0) o.push(rect(s.x0, Y(lv), s.x1, Y(lv - SLAB), '#6b7280'));
    const open = f.lw.rooms.length > 0 && f.lw.rooms.every((r) => OPEN_ROOM.test(r.name));
    const h = open ? PARAPET + 0.45 : f.height - (i + 1 < floors.length ? SLAB : 0);
    o.push(
      rect(s.x0, Y(lv), s.x0 + wallT, Y(lv + h), '#9ca3af'),
      rect(s.x1 - wallT, Y(lv), s.x1, Y(lv + h), '#9ca3af'),
    );
    o.push(
      `<text x="${f1(U((s.x0 + s.x1) / 2))}" y="${f1(U(Y(lv + f.height / 2)))}" font-size="${fs(13)}" font-weight="600" text-anchor="middle" fill="${INK}">${esc(f.storey.name.toUpperCase())}</text>`,
    );
  });
  const ts = spans[spans.length - 1] ?? { x0, x1 };
  o.push(rect(ts.x0, Y(roof), ts.x1, Y(roof - SLAB), '#6b7280'));
  o.push(
    rect(ts.x0, Y(roof), ts.x0 + 0.11, Y(roof + PARAPET), '#9ca3af'),
    rect(ts.x1 - 0.11, Y(roof), ts.x1, Y(roof + PARAPET), '#9ca3af'),
  );

  // Heights on the left (floor to floor, then overall); levels on the right.
  const levels = [...floors.map((f) => f.storey.elevation), roof];
  o.push(dimChain(levels.map(Y), x0 - 0.7 * TS, false, x0 - 0.1, -1));
  o.push(dimChain([Y(-PLINTH), Y(roof + PARAPET)], x0 - 1.3 * TS, false, x0 - 0.1, -1));
  for (const lv of levels) o.push(levelMark(x1 + 0.5 * TS, Y(lv), lv));
  // The yard and the parapet top sit close to a floor level: their marks stand further out.
  for (const lv of [-PLINTH, roof + PARAPET]) o.push(levelMark(x1 + 1.3 * TS, Y(lv), lv));
  o.push(
    `<text x="${f1(U(left + 0.3))}" y="${f1(U(bottom - 0.4 * TS))}" font-size="${fs(20)}" font-weight="700" fill="${INK}">${esc(title.toUpperCase())}</text>`,
    `<text x="${f1(U(left + 0.3))}" y="${f1(U(bottom - 0.15 * TS))}" font-size="${fs(11)}" fill="${THIN}">${floors.length} floors · plinth ${PLINTH * 1000} mm · slabs ${SLAB * 1000} mm · parapet ${PARAPET * 1000} mm · top ${levelText(roof + PARAPET)}</text>`,
  );
  o.push('</svg>');
  return o.join('\n');
}
