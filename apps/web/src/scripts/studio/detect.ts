/**
 * Wall detection: turns the lines inside the chosen region into a Roomcraft plan.
 *
 * 1. Keep horizontal and vertical lines; merge pieces that continue each other.
 * 2. A wall is two parallel lines 6–65 cm apart with nothing parallel between them, whose band is hatched
 *    (cut walls are hatched on architectural plans; dimension and extension lines aren't). Concrete, drawn with
 *    sparse hatch, counts when the band is a closed block. DXF files carry no hatch strokes, so there wall layers
 *    ("WALL", "TUONG", …) count instead.
 * 3. Pieces on one line join up; gaps of a door's or window's width become openings: an arc nearby means a door
 *    (two half-width swings a double door), offset panel lines a sliding door, glazing lines a window. Short
 *    cross-cuts inside a wall's body, and frame lines along one, are dropped.
 * 4. Ends snap to the walls they run into, so corners and T-junctions share nodes and rooms close; where a facade
 *    changes thickness, the offset centre lines are joined by a short cross piece.
 * It is a heuristic: the result is meant to be checked and fixed in the plan editor (or by the AI clean-up).
 */
import {
  findRooms,
  pointInPoly,
  splitWall,
  tidy,
  uid,
  type Opening,
  type Plan,
  type PlanNode,
  type Wall,
} from '../room/plan';
import type { CustomDef, CustomPart } from '../room/custom';
import { inRegion, type Drawing, type Region, type Segment } from './drawing';

interface Line {
  /** Constant coordinate (y for horizontal, x for vertical) and the span along it, in millimetres. */
  c: number;
  a: number;
  b: number;
  layer?: string;
  /** Pen width (PDF). */
  pen?: number;
}
interface WallPiece {
  o: 'H' | 'V';
  c: number;
  a: number;
  b: number;
  t: number;
}

const WALL_LAYER = /wall|tuong|tường|a-wall|mur|wand/i;

export interface DetectResult {
  plan: Plan;
  walls: number;
  openings: number;
}

export function detectWalls(d: Drawing, region: Region): DetectResult {
  const k = d.mmPerUnit ?? 1;
  // Work in millimetres with y up; the plan later flips to z down and starts near the origin.
  const clip = (s: Segment): Segment | null => {
    const a = inRegion(region, s.x1, s.y1);
    const b = inRegion(region, s.x2, s.y2);
    if (!a && !b) return null;
    if (a && b) return s;
    // Clip axis-aligned lines that leave the region; drop anything else that crosses it.
    const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (Math.abs(s.y1 - s.y2) < 1e-6 || Math.abs(s.x1 - s.x2) < 1e-6)
      return {
        ...s,
        x1: cl(s.x1, region.x0, region.x1),
        x2: cl(s.x2, region.x0, region.x1),
        y1: cl(s.y1, region.y0, region.y1),
        y2: cl(s.y2, region.y0, region.y1),
      };
    return null;
  };
  const segs = withoutAnnotation(d)
    .map(clip)
    .filter((s): s is Segment => !!s);

  const H: Line[] = [];
  const V: Line[] = [];
  const hatch: { x: number; y: number; L: number }[] = [];
  const curves: { x: number; y: number; L: number; pen?: number; pieced?: true }[] = [];
  /** Curve chords in drawing order (mm), with their pen and layer, for curved walls. */
  const chords: (Chord & { pen?: number; layer?: string })[] = [];
  const angTol = Math.tan((1.5 * Math.PI) / 180);
  /** Length of long straight strokes per pen width, to tell the wall pen from the rest. */
  const penLen = new Map<number, number>();
  for (const s of segs) {
    const x1 = s.x1 * k;
    const y1 = s.y1 * k;
    const x2 = s.x2 * k;
    const y2 = s.y2 * k;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const L = Math.hypot(dx, dy);
    if (s.curve) {
      curves.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, L, pen: s.pen });
      chords.push({ x1, y1, x2, y2, pen: s.pen, layer: s.layer });
      continue;
    }
    if (L < 30) continue;
    const axis = dy <= dx * angTol || dx <= dy * angTol;
    if (axis && L >= 300 && s.pen !== undefined) penLen.set(s.pen, (penLen.get(s.pen) ?? 0) + L);
    if (dy <= dx * angTol)
      H.push({ c: (y1 + y2) / 2, a: Math.min(x1, x2), b: Math.max(x1, x2), layer: s.layer, pen: s.pen });
    else if (dx <= dy * angTol)
      V.push({ c: (x1 + x2) / 2, a: Math.min(y1, y2), b: Math.max(y1, y2), layer: s.layer, pen: s.pen });
    else {
      hatch.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, L });
      // Some programs export a door's swing as a run of short straight pieces rather than a curve: such pieces count
      // as curve too (a swing must still lie on a quarter circle about a jamb, which hatch strokes don't).
      if (L < 150 && s.pen !== undefined)
        curves.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, L, pen: s.pen, pieced: true });
    }
  }
  /*
   * The wall pen. Drawings print cut walls with the heaviest pens (TCVN 8: thick lines at least twice thin ones), and
   * furniture, fixtures, hatch, dimensions and frames with fine ones. Among the pens that draw a real share of the long
   * straight lines, the finest is the fine pen; pens at least 1.4 times heavier draw walls. Only lines in those pens
   * pair into walls; every line still counts as evidence for doors and windows. Without clear classes (one pen, or a
   * DXF), every line may pair, as before.
   */
  const totalPen = [...penLen.values()].reduce((t, v) => t + v, 0);
  // Width 0 is a hairline (the thinnest the device draws): fine by definition, not a class to measure from.
  const pens = [...penLen].filter(([p, v]) => p > 0 && v >= totalPen * 0.08).map(([p]) => p);
  const fine = pens.length >= 2 ? Math.min(...pens) : 0;
  const heavyShare =
    [...penLen].filter(([p]) => fine > 0 && p >= fine * 1.4).reduce((t, [, v]) => t + v, 0) / (totalPen || 1);
  // Filter only where the heavy pens carry a real share of the long lines: some offices draw only part of the walls
  // heavy, and filtering would lose the rest.
  const wallPen = fine > 0 && heavyShare >= 0.2 ? fine * 1.4 : null;
  /** Curved walls come from the heavier pens in any case (the fine ones draw door swings, furniture, fixtures). */
  const curvePen = wallPen ?? (fine > 0 ? fine * 1.4 : null);
  const heavy = (l: Line) => wallPen === null || (l.pen ?? 0) >= wallPen - 1e-6;
  /**
   * The pen the walls themselves are cut with (the heaviest that carries a real share of them). An arc in that pen is
   * a curved wall (a niche, a rounded corner), not a door's swing, which plans draw finer.
   */
  const wallTop = (() => {
    if (wallPen === null) return null;
    const hp = [...penLen].filter(([p]) => p >= wallPen - 1e-6);
    const total = hp.reduce((t, [, v]) => t + v, 0);
    const main = hp.filter(([, v]) => v >= total * 0.25).map(([p]) => p);
    return main.length ? Math.max(...main) : null;
  })();
  // Swings pieced from straight strokes count only in the finest pen (a rounded stair end or a table is drawn heavier).
  const swingPen = (cv: { pen?: number; pieced?: true }) =>
    cv.pieced ? fine > 0 && (cv.pen ?? 0) <= fine * 1.2 + 1e-6 : wallTop === null || (cv.pen ?? 0) < wallTop * 0.8;
  const area = Math.max(1, (region.x1 - region.x0) * (region.y1 - region.y0) * k * k);
  let hatched = hatch.reduce((s, h) => s + h.L, 0) / area > 0.0005;
  const layered = [...H, ...V].some((l) => l.layer && WALL_LAYER.test(l.layer));

  const merge = (list: Line[]) => {
    list.sort((p, q) => p.c - q.c || p.a - q.a);
    const out: Line[] = [];
    for (const l of list) {
      const m = out.find(
        (o) =>
          Math.abs(o.c - l.c) < 6 && l.a <= o.b + 15 && l.b >= o.a - 15 && o.layer === l.layer && heavy(o) === heavy(l),
      );
      if (m) {
        m.a = Math.min(m.a, l.a);
        m.b = Math.max(m.b, l.b);
      } else out.push({ ...l });
    }
    return out;
  };
  /**
   * Stair treads: four or more lines of the same extent, evenly spaced 15–35 cm apart. Any two neighbours look like a
   * thin wall, so they are left out of wall pairing (they still count as lines for windows and doors).
   */
  const treadsOf = (list: Line[]) => {
    const out = new Set<Line>();
    const cand = list.filter((l) => l.b - l.a >= 500 && l.b - l.a <= 2000);
    for (const l of cand) {
      if (out.has(l)) continue;
      const run = [l];
      for (let last = l; ;) {
        const step = run.length > 1 ? last.c - run[run.length - 2]!.c : 0;
        const next = cand.find(
          (r) =>
            r.c > last.c &&
            Math.abs(r.a - l.a) < 60 &&
            Math.abs(r.b - l.b) < 60 &&
            r.c - last.c >= 150 &&
            r.c - last.c <= 350 &&
            (!step || Math.abs(r.c - last.c - step) < step * 0.2),
        );
        if (!next) break;
        run.push(next);
        last = next;
      }
      if (run.length >= 4) for (const r of run) out.add(r);
    }
    return out;
  };
  const HM = merge(H);
  const VM = merge(V);
  const treads = new Set([...treadsOf(HM), ...treadsOf(VM)]);

  const hatchDensity = (o: 'H' | 'V', c0: number, c1: number, a: number, b: number) => {
    let L = 0;
    for (const h of hatch) {
      const along = o === 'H' ? h.x : h.y;
      const across = o === 'H' ? h.y : h.x;
      if (along > a && along < b && across > c0 && across < c1) L += h.L;
    }
    return L / ((b - a) * (c1 - c0));
  };

  /*
   * Diagonals elsewhere (a void's cross, stair arrows, a planting hatch) don't make this a hatched drawing: its walls
   * must hold the hatch. Plans whose walls are plain double lines next to such diagonals are read as unhatched.
   */
  if (hatched) {
    let all = 0;
    let filled = 0;
    for (const [list, o] of [
      [HM, 'H'],
      [VM, 'V'],
    ] as const)
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const gap = list[j]!.c - list[i]!.c;
          if (gap < 60) continue;
          if (gap > 320) break;
          const a = Math.max(list[i]!.a, list[j]!.a);
          const b = Math.min(list[i]!.b, list[j]!.b);
          if (b - a < 450) continue;
          all += b - a;
          if (hatchDensity(o, list[i]!.c, list[j]!.c, a, b) >= 0.01) filled += b - a;
        }
    hatched = filled > all * 0.08;
  }

  /**
   * Cast concrete is drawn with sparse diagonals and aggregate marks, far below brick hatch density. Such a band
   * still counts as wall when it is a closed block — both ends capped by a line straight across — holding a real
   * pattern (several strokes). A rectangle with one or two diagonals (a beam, a shaft, a shower tray) is not.
   */
  const concreteBlock = (o: 'H' | 'V', c0: number, c1: number, a: number, b: number) => {
    let n = 0;
    for (const h of hatch) {
      const along = o === 'H' ? h.x : h.y;
      const across = o === 'H' ? h.y : h.x;
      if (along > a && along < b && across > c0 && across < c1) n++;
    }
    if (n < 4 || hatchDensity(o, c0, c1, a, b) < 0.002) return false;
    const cross = o === 'H' ? VM : HM;
    const capped = (at: number) => cross.some((r) => Math.abs(r.c - at) < 20 && r.a <= c0 + 20 && r.b >= c1 - 20);
    return capped(a) && capped(b);
  };

  const pair = (list: Line[], o: 'H' | 'V') => {
    const out: WallPiece[] = [];
    // Hatched blocks up to 1 m thick are columns and service shafts: keep them as thick walls. On a wall layer, short
    // piers between windows count too.
    const maxT = hatched ? 1000 : 320;
    const minLen = hatched || layered ? 100 : 250;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      if (treads.has(p) || !heavy(p)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j]!;
        const gap = q.c - p.c;
        if (gap < 60 || treads.has(q) || !heavy(q)) continue;
        if (gap > maxT) break;
        const a = Math.max(p.a, q.a);
        const b = Math.min(p.b, q.b);
        if (b - a < minLen) continue;
        const between = list.some(
          (r) =>
            heavy(r) &&
            r !== p &&
            r !== q &&
            r.c > p.c + 6 &&
            r.c < q.c - 6 &&
            r.a < b - 25 &&
            r.b > a + 25 &&
            r.b - r.a > (b - a) * 0.6,
        );
        if (between) continue;
        if (hatched) {
          if (hatchDensity(o, p.c, q.c, a, b) < 0.01 && !concreteBlock(o, p.c, q.c, a, b)) continue;
        } else if (layered && !(WALL_LAYER.test(p.layer ?? '') && WALL_LAYER.test(q.layer ?? ''))) continue;
        out.push({ o, c: (p.c + q.c) / 2, a, b, t: gap });
      }
    }
    return out;
  };
  const pieces = [...pair(HM, 'H'), ...pair(VM, 'V')];

  /** Window symbols: an outer pair 6–32 cm apart with at least one more parallel line between and no hatch. */
  const glazingBands = (list: Line[], o: 'H' | 'V') => {
    const out: WallPiece[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j]!;
        const gap = q.c - p.c;
        if (gap < 60) continue;
        if (gap > 320) break;
        const a = Math.max(p.a, q.a);
        const b = Math.min(p.b, q.b);
        if (b - a < 450) continue;
        const inner = list.filter((r) => r.c > p.c + 6 && r.c < q.c - 6 && r.a < b - 25 && r.b > a + 25).length;
        if (inner < 1 || (hatched && hatchDensity(o, p.c, q.c, a, b) > 0.004)) continue;
        out.push({ o, c: (p.c + q.c) / 2, a, b, t: gap });
      }
    }
    return out;
  };
  const glazing = [...glazingBands(HM, 'H'), ...glazingBands(VM, 'V')];

  /* ---------- Join pieces on the same line; gaps of door/window size become openings ---------- */
  interface Run {
    o: 'H' | 'V';
    c: number;
    a: number;
    b: number;
    t: number;
    holes: {
      a: number;
      b: number;
      kind: Opening['kind'];
      flip: number;
      hingeHi?: boolean;
      leaves?: 2;
      tall?: boolean;
    }[];
    /** A short connector added where a wall changes thickness; kept however short it is. */
    joint?: boolean;
  }
  const runs: Run[] = [];
  pieces.sort((p, q) => (p.o === q.o ? p.c - q.c || p.a - q.a : p.o < q.o ? -1 : 1));
  for (const p of pieces) {
    // The nearest run on the same line that this piece continues (a gate's far jamb may be up to 5.2 m on).
    const r = runs
      .filter(
        (x) => x.o === p.o && Math.abs(x.c - p.c) < 40 && Math.abs(x.t - p.t) < 60 && p.a <= x.b + 5200 && p.a >= x.a,
      )
      .reduce<Run | undefined>((best, x) => (!best || x.b > best.b ? x : best), undefined);
    if (!r) {
      runs.push({ ...p, holes: [] });
      continue;
    }
    const gap = p.a - r.b;
    if (gap > 60) {
      // Wider than a door: only a gate of two or four folding leaves (a shop-house front, a garage) can span it.
      const wide = gap > 3000;
      if (gap > 5200) {
        // Too long for an opening: a separate wall.
        runs.push({ ...p, holes: [] });
        continue;
      }
      if (gap < 450) {
        // Too narrow for a door: the wall carries on through a column, a pipe box or a break in its face lines.
        r.b = Math.max(r.b, p.b);
        r.c = (r.c + p.c) / 2;
        continue;
      }
      const lo = r.b;
      const hi = p.a;
      const inGap = (x: number, y: number, reach: number) => {
        const along = p.o === 'H' ? x : y;
        const across = p.o === 'H' ? y : x;
        return along > lo - 50 && along < hi + 50 && Math.abs(across - p.c) < reach;
      };
      const alongOf = (cv: { x: number; y: number }) => (p.o === 'H' ? cv.x : cv.y);
      const acrossOf = (cv: { x: number; y: number }) => (p.o === 'H' ? cv.y : cv.x) - p.c;
      // A swing is a quarter circle about a jamb, as wide as the gap (half as wide for each leaf of a double door),
      // cut into short chords on import. Only curve pieces on such a circle count, so a basin or a bathtub drawn
      // near the doorway doesn't.
      const swings = [lo, hi].flatMap((j) => [gap, gap / 2].map((rad): [number, number] => [j, rad]));
      const onSwing = (cv: { x: number; y: number }) =>
        swings.some(([j, rad]) => {
          const d = Math.hypot(alongOf(cv) - j, Math.abs(acrossOf(cv)) - p.t / 2);
          return Math.abs(d - rad) < rad * 0.15 + 40;
        });
      const arcs = curves.filter((cv) => swingPen(cv) && inGap(cv.x, cv.y, gap + 100) && onSwing(cv));
      // The side with the most swing is the side the door opens to; its length tells it is a door at all.
      const sideLen = (sgn: number) => arcs.filter((cv) => acrossOf(cv) * sgn > 0).reduce((s, cv) => s + cv.L, 0);
      const side = sideLen(1) >= sideLen(-1) ? 1 : -1;
      const swing = arcs.filter((cv) => acrossOf(cv) * side > 0);
      // A gate: each leaf swings about its own hinge, so there are swings on circles about at least three of the
      // hinge points (both jambs of a pair and the meeting point, or the hinges of a four-leaf fold). A curved
      // balcony or a round window drawn across the gap doesn't have that.
      const gate =
        wide &&
        [2, 4].some((n) => {
          const rad = gap / n;
          let hinges = 0;
          for (let k = 0; k <= n; k++) {
            const j = lo + rad * k;
            const len = curves
              .filter((cv) => swingPen(cv) && inGap(cv.x, cv.y, rad + 100))
              .filter(
                (cv) => Math.abs(Math.hypot(alongOf(cv) - j, Math.abs(acrossOf(cv)) - p.t / 2) - rad) < rad * 0.1 + 30,
              )
              .reduce((t, cv) => t + cv.L, 0);
            if (len > rad * 0.6) hinges++;
          }
          return hinges >= 3;
        });
      const door = wide ? gate : sideLen(side) >= gap * 0.8;
      // A double door: two swings half as wide, one from each jamb, so they reach only half the gap out from the wall.
      const reachOut = Math.max(0, ...swing.map((cv) => Math.abs(acrossOf(cv))));
      const double =
        door &&
        reachOut < gap * 0.7 &&
        swing.some((cv) => alongOf(cv) < lo + gap * 0.4) &&
        swing.some((cv) => alongOf(cv) > hi - gap * 0.4);
      // The hinge is the jamb farther from the middle of the swing (a quarter circle's centroid lies about two
      // thirds of the way across, towards the jamb the leaf closes against).
      const mid = swing.reduce((s, cv) => s + alongOf(cv) * cv.L, 0) / Math.max(1e-6, sideLen(side));
      const hingeHi = hi - mid > mid - lo;
      const lines = (p.o === 'H' ? HM : VM).filter((l) => Math.abs(l.c - p.c) < p.t / 2 && l.a < hi && l.b > lo);
      // A sliding door: two panels, each part of the width, on offset tracks — one from each jamb, overlapping in the
      // middle. (A window's pane lines run the full width.)
      const cover = (l: Line) => Math.min(l.b, hi) - Math.max(l.a, lo);
      // A panel lies within the opening, between the wall faces (a face line running on from the next wall isn't one).
      const panel = (l: Line) =>
        cover(l) > gap * 0.3 &&
        cover(l) < gap * 0.8 &&
        l.a >= lo - 60 &&
        l.b <= hi + 60 &&
        Math.abs(l.c - p.c) < p.t / 2 - 10;
      const left = lines.find((l) => panel(l) && l.a <= lo + 60);
      const right = lines.find((l) => panel(l) && l.b >= hi - 60 && l !== left);
      // A sliding window looks the same but has sill lines across the full width; a door reaches the floor.
      const sliding =
        !door &&
        !!left &&
        !!right &&
        Math.abs(left.c - right.c) > 15 &&
        left.b > right.a &&
        !lines.some((l) => cover(l) >= gap * 0.9);
      // A door-wide gap between two pieces of one wall with nothing drawn in it is a doorway too: permit drawings and
      // simplified plans often leave the swing out. (Gaps in the valley between doors and windows, 1.5–3 m, need
      // evidence.)
      // A face line running on unbroken across the gap means the wall is whole there: only its other face is broken
      // (where a curved partition or a niche meets it), so it is no doorway.
      const faceOn = (p.o === 'H' ? H : V).some(
        (l) => [p.c - p.t / 2, p.c + p.t / 2].some((f) => Math.abs(l.c - f) < 25) && l.a <= lo + 20 && l.b >= hi - 20,
      );
      const plain = !door && !sliding && lines.length < 2 && !wide && gap >= 600 && gap <= 1500 && !faceOn;
      // Otherwise only a gap with evidence becomes an opening: a swing arc (door), panels (sliding door) or glazing.
      if ((!door && !sliding && lines.length < 2 && !plain) || (wide && !gate)) {
        runs.push({ ...p, holes: [] });
        continue;
      }
      r.holes.push({
        a: lo,
        b: hi,
        kind: door || plain ? 'door' : 'window',
        // Plan walls run left to right (H) or up the drawing (V), with the normal to their left: for an H wall that
        // is down the drawing, so a swing up the drawing (+y) is flip -1; for a V wall it is +x, flip 1.
        flip: p.o === 'H' ? -side : side,
        hingeHi,
        ...(double || gate ? { leaves: 2 as const } : {}),
        ...(sliding ? { tall: true } : {}),
      });
    }
    r.b = Math.max(r.b, p.b);
    r.c = (r.c + p.c) / 2;
  }
  /*
   * Cross lines inside a hatched wall (block ends, joints between materials) pair up into short "walls" running
   * across it. They sit wholly inside a longer perpendicular wall's body: drop them, or the walls that meet there
   * snap to them instead of to each other and the room doesn't close.
   */
  const inside = (p: Run, q: Run) =>
    p.o !== q.o &&
    q.b - q.a > Math.max(1000, (p.b - p.a) * 2) &&
    p.a >= q.c - q.t / 2 - 20 &&
    p.b <= q.c + q.t / 2 + 20 &&
    p.c - p.t / 2 >= q.a - 20 &&
    p.c + p.t / 2 <= q.b + 20;
  const crossCuts = runs.filter((p) => !p.holes.length && runs.some((q) => inside(p, q)));
  for (const p of crossCuts) runs.splice(runs.indexOf(p), 1);

  // A glazing band continuing a wall line (or bridging to it) becomes wall with a window across the band.
  // Attaching one band lengthens the wall, which can bring the next band within reach: repeat until nothing changes,
  // so the result doesn't depend on the order the bands were found in.
  const pending = new Set(glazing);
  for (let changed = true; changed;) {
    changed = false;
    for (const g of pending) {
      const covered = runs.some((r) => r.o === g.o && Math.abs(r.c - g.c) < 60 && g.a >= r.a - 50 && g.b <= r.b + 50);
      if (covered) {
        pending.delete(g);
        continue;
      }
      const near = runs.find(
        (r) => r.o === g.o && Math.abs(r.c - g.c) < 60 && (Math.abs(g.a - r.b) < 400 || Math.abs(r.a - g.b) < 400),
      );
      // A band on its own is usually dimension or extension lines, not a window: leave it.
      if (!near) continue;
      near.holes.push({ a: Math.max(g.a, near.b), b: g.b <= near.a ? near.a : g.b, kind: 'window', flip: 1 });
      if (g.b <= near.a) near.holes[near.holes.length - 1]!.a = g.a;
      near.a = Math.min(near.a, g.a);
      near.b = Math.max(near.b, g.b);
      pending.delete(g);
      changed = true;
    }
  }

  // A door or window frame drawn just inside a wall pairs up into a thin "wall" lying along it (it would stand in the
  // opening and flicker against the wall's face): drop a plain run that lies within a longer parallel wall's body.
  const along = (p: Run, q: Run) =>
    p !== q &&
    p.o === q.o &&
    !p.joint &&
    q.b - q.a > p.b - p.a &&
    Math.abs(p.c - q.c) < (p.t + q.t) / 2 &&
    Math.min(p.b, q.b) - Math.max(p.a, q.a) >= (p.b - p.a) * 0.8;
  const frames = runs.filter((p) => !p.holes.length && runs.some((q) => along(p, q)));
  for (const p of frames) runs.splice(runs.indexOf(p), 1);

  // Two walls side by side whose bodies touch or overlap (a wall drawn with three or four face lines — cladding, a
  // sill, a column face — pairs up twice): one wall spanning both, or the sliver between them reads as a room.
  for (let merged = true; merged;) {
    merged = false;
    for (const p of runs)
      for (const q of runs) {
        if (p === q || p.o !== q.o || p.joint || q.joint) continue;
        const lo = Math.min(p.c - p.t / 2, q.c - q.t / 2);
        const hi = Math.max(p.c + p.t / 2, q.c + q.t / 2);
        const overlap = Math.min(p.b, q.b) - Math.max(p.a, q.a);
        if (hi - lo > Math.max(p.t, q.t) + 160 || hi - lo > 450) continue;
        if (overlap < Math.min(p.b - p.a, q.b - q.a) * 0.5) continue;
        // Holes along the merged length, from either piece.
        p.holes.push(...q.holes);
        p.a = Math.min(p.a, q.a);
        p.b = Math.max(p.b, q.b);
        p.c = (lo + hi) / 2;
        p.t = hi - lo;
        runs.splice(runs.indexOf(q), 1);
        merged = true;
        break;
      }
  }

  /* ---------- Snap ends onto the walls they meet ---------- */
  const reach = (r: Run, s: Run) => r.t / 2 + s.t / 2 + 150;
  /** Ends already landed on a wall; the gap-closing pass below must not drag them onto another one. */
  const snapped = new Set<string>();
  for (const r of runs) {
    for (const end of ['a', 'b'] as const) {
      const pos = r[end];
      let best: { v: number; d: number } | null = null;
      for (const s of runs) {
        if (s === r || s.o === r.o) continue;
        // s is perpendicular: its line is at s.c (along r's axis); r's line must fall within s's span.
        if (r.c < s.a - reach(r, s) || r.c > s.b + reach(r, s)) continue;
        const d = Math.abs(s.c - pos);
        if (d < reach(r, s) && (!best || d < best.d)) best = { v: s.c, d };
      }
      if (best) {
        r[end] = best.v;
        snapped.add(`${runs.indexOf(r)}${end}`);
      }
    }
  }
  // A wall that stops short of the wall ahead of it while one of its face lines carries on there (its other face was
  // broken by a cupboard, a column or a door frame drawn against it): extend it to that wall, so the room closes.
  const facesOf = (o: 'H' | 'V') => (o === 'H' ? HM : VM);
  for (const [i, r] of runs.entries()) {
    if (r.joint) continue;
    for (const end of ['a', 'b'] as const) {
      if (snapped.has(`${i}${end}`)) continue;
      const dir = end === 'a' ? -1 : 1;
      const pos = r[end];
      let best: Run | null = null;
      let bd = Infinity;
      for (const s of runs) {
        if (s.o === r.o || r.c < s.a - s.t / 2 - 20 || r.c > s.b + s.t / 2 + 20) continue;
        const dist = (s.c - pos) * dir;
        if (dist > 0 && dist <= 1500 && dist < bd) {
          best = s;
          bd = dist;
        }
      }
      if (!best) continue;
      const lo = Math.min(pos, best.c - (dir * best.t) / 2);
      const hi = Math.max(pos, best.c - (dir * best.t) / 2);
      const covered = facesOf(r.o)
        .filter((l) => Math.abs(l.c - r.c) <= r.t / 2 + 15 && l.a <= hi && l.b >= lo)
        .reduce((m, l) => Math.max(m, Math.min(l.b, hi) - Math.max(l.a, lo)), 0);
      if (covered < (hi - lo) * 0.6) continue;
      r[end] = best.c;
      snapped.add(`${i}${end}`);
    }
  }
  // Perpendicular walls whose spans stop short of each other's lines (an L corner drawn with a gap): extend.
  for (const r of runs)
    for (const s of runs) {
      if (r.o === s.o) continue;
      for (const e of ['a', 'b'] as const)
        if (
          !snapped.has(`${runs.indexOf(s)}${e}`) &&
          Math.abs(s[e] - r.c) < reach(r, s) &&
          s.c >= r.a - reach(r, s) &&
          s.c <= r.b + reach(r, s)
        ) {
          s[e] = r.c;
          if (s.c < r.a) r.a = s.c;
          if (s.c > r.b) r.b = s.c;
        }
    }
  // Where a facade changes thickness (a concrete block meeting a brick wall), the two pieces' centre lines are offset.
  // Meet them at a common point and join the lines with a short cross piece, so the outline stays one closed loop.
  const joints: Run[] = [];
  for (const r of runs)
    for (const s of runs) {
      if (r === s || r.o !== s.o || r.joint || s.joint) continue;
      const off = Math.abs(r.c - s.c);
      // Up to a column's width apart (a column box between them is not paired as wall).
      if (off > (r.t + s.t) / 2 + 30 || s.a - r.b > 450 || r.b - s.a > 150) continue;
      if (off < 10) {
        // One line carrying on (a thin stretch meeting a thick one, ends overlapping or a hair apart): meet them.
        r.b = s.a = (r.b + s.a) / 2;
        continue;
      }
      const at = (r.b + s.a) / 2;
      const lo = Math.min(r.c, s.c);
      const hi = Math.max(r.c, s.c);
      // Already joined by a perpendicular wall through that point.
      const joined = runs.some((x) => x.o !== r.o && Math.abs(x.c - at) < 60 && x.a <= lo + 20 && x.b >= hi - 20);
      if (joined) continue;
      r.b = at;
      s.a = at;
      joints.push({ o: r.o === 'H' ? 'V' : 'H', c: at, a: lo, b: hi, t: Math.min(r.t, s.t), holes: [], joint: true });
    }
  runs.push(...joints);

  /* ---------- Build the plan (metres, z down, origin at the region's top-left) ---------- */
  const ox = region.x0 * k;
  const oy = region.y1 * k;
  const toPlan = (o: 'H' | 'V', c: number, along: number): [number, number] =>
    o === 'H' ? [(along - ox) / 1000, (oy - c) / 1000] : [(c - ox) / 1000, (oy - along) / 1000];
  const plan: Plan = { nodes: [], walls: [], openings: [], items: [], rooms: {}, north: 0 };
  const nodeAt = (x: number, z: number): PlanNode => {
    const found = plan.nodes.find((n) => Math.hypot(n.x - x, n.z - z) < 0.03);
    if (found) return found;
    const n = { id: uid('n'), x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
    plan.nodes.push(n);
    return n;
  };
  for (const r of runs) {
    const L = r.b - r.a;
    if (L < (r.joint ? 10 : 250)) continue;
    const [ax, az] = toPlan(r.o, r.c, r.a);
    const [bx, bz] = toPlan(r.o, r.c, r.b);
    const w: Wall = { id: uid('w'), a: nodeAt(ax, az).id, b: nodeAt(bx, bz).id, thick: Math.round(r.t / 10) / 100 };
    plan.walls.push(w);
    for (const h of r.holes) {
      const a = Math.max(r.a + 30, h.a);
      const b = Math.min(r.b - 30, h.b);
      if (b - a < 300) continue;
      plan.openings.push({
        id: uid('o'),
        wall: w.id,
        kind: h.kind,
        t: ((a + b) / 2 - r.a) / L,
        width: (b - a) / 1000,
        flip: h.flip,
        // Node b is at the high end of the run; flip 1 hinges there by default.
        ...(h.kind === 'door' && !h.leaves && h.hingeHi !== h.flip > 0 ? { hand: -1 as const } : {}),
        ...(h.leaves ? { leaves: h.leaves } : {}),
        ...(h.tall ? { tall: true } : {}),
      });
    }
  }
  // Curved walls (a rounded stair hall, a bay, a curved bedroom wall): pairs of concentric curves in the wall pen (or
  // on a wall layer), built as a run of short straight walls along their centre line.
  const wallChords = chords.filter((c) =>
    curvePen !== null ? (c.pen ?? 0) >= curvePen - 1e-6 : !!c.layer && WALL_LAYER.test(c.layer),
  );
  const toPlanPt = (x: number, y: number) => [(x - ox) / 1000, (oy - y) / 1000] as const;
  /** Pieces of curved walls: short by design, so never taken for stubs. */
  const curved = new Set<string>();
  /** Single heavy curves (built-ins, not walls), as polylines in plan metres. */
  const builtIns: [number, number][][] = [];
  // Pairs of curves make a curved wall. A single heavy curve is not a wall: drawn in the cut pen beside a bed or in a
  // corner, it is a tall built-in (a curved wardrobe front, a display niche), built as curved panels.
  for (const cw of curvedWalls(wallChords, wallTop)) {
    // A curve shorter than a door leaf is a fixture's edge, not a wall.
    const span = cw.pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - cw.pts[i]![0], p[1] - cw.pts[i]![1]), 0);
    if (span < 400) continue;
    if (cw.single) {
      builtIns.push(cw.pts.map((p) => toPlanPt(...p) as unknown as [number, number]));
      continue;
    }
    const ids = cw.pts.map((p) => nodeAt(...toPlanPt(...p)));
    for (let i = 1; i < ids.length; i++)
      if (ids[i] !== ids[i - 1]) {
        const id = uid('w');
        curved.add(id);
        plan.walls.push({ id, a: ids[i - 1]!.id, b: ids[i]!.id, thick: Math.round(cw.t / 10) / 100 });
      }
  }
  // T-junctions: an end landing on another wall's middle splits that wall there, so rooms close.
  for (const n of [...plan.nodes]) {
    for (const w of [...plan.walls]) {
      if (w.a === n.id || w.b === n.id) continue;
      const a = plan.nodes.find((m) => m.id === w.a)!;
      const b = plan.nodes.find((m) => m.id === w.b)!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const t = ((n.x - a.x) * (b.x - a.x) + (n.z - a.z) * (b.z - a.z)) / (L * L);
      if (t <= 0.01 || t >= 0.99) continue;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const off = Math.hypot(px - n.x, pz - n.z);
      // Within the wall's body counts when the node's own wall meets this one square-on (a partition stopping at the
      // face of a thicker wall, or at a thin piece beside it).
      const across = plan.walls.some((x) => {
        if (x.a !== n.id && x.b !== n.id) return false;
        const p = plan.nodes.find((m) => m.id === (x.a === n.id ? x.b : x.a))!;
        const dot =
          ((p.x - n.x) * (b.x - a.x) + (p.z - n.z) * (b.z - a.z)) / (Math.hypot(p.x - n.x, p.z - n.z) * L || 1);
        return Math.abs(dot) < 0.2;
      });
      // A curved wall's end meets a wall at a slant or along it (a curved partition leaving a straight wall): joined
      // wherever it lies within that wall's body.
      const curvedEnd = plan.walls.some((x) => (x.a === n.id || x.b === n.id) && curved.has(x.id));
      if (off > 0.03 && !((across || curvedEnd) && off <= (w.thick ?? 0.15) / 2 + 0.03)) continue;
      const mid = splitWall(plan, w, t);
      if (off > 0.03) {
        // Inside the wall's body but off its centre line: a short piece inside the body joins the two, so neither
        // wall slants.
        const own = plan.walls.find((x) => x.a === n.id || x.b === n.id)!;
        plan.walls.push({ id: uid('w'), a: n.id, b: mid.id, thick: own.thick });
        continue;
      }
      // Re-point the new node to the existing one.
      for (const x of plan.walls) {
        if (x.a === mid.id) x.a = n.id;
        if (x.b === mid.id) x.b = n.id;
      }
    }
  }
  closeDangles(plan, 1.0, curved);
  // Small clusters of walls apart from the building, with no door or window, are notes and symbols read as walls
  // (a legend box, a north arrow, a furniture block): keep only clusters of some size or joined to the main one.
  dropStrayClusters(plan);
  // Kitchen units, counters and table edges drawn with a lighter pen than the walls, read as walls (D4).
  // Stairs: runs of treads (short parallel lines evenly spaced). Their outlines and stringers are not walls.
  const flights = stairZones(H, V);
  const pairs = uStairs(flights);
  // Weak runs (three or four treads) only where they make a U with a full flight.
  const stairs = [...flights.filter((f) => f.strong), ...pairs];
  dropLightPenWalls(plan, H, V, penLen, wallPen, ox, oy, stairs);
  // Two flights side by side climbing opposite ways are a U stair (a dog-leg): it stands there, rising to the floor
  // above. A single flight may be the end of the stair from the floor below, so it is left to the drawing check.
  for (const u of pairs) {
    const [x0, z0] = [(u.x0 - ox) / 1000, (oy - u.y1) / 1000];
    const [x1, z1] = [(u.x1 - ox) / 1000, (oy - u.y0) / 1000];
    const [x, z] = [(x0 + x1) / 2, (z0 + z1) / 2];
    if (plan.items.some((it) => /^stairs/.test(it.type) && Math.hypot(it.x - x, it.z - z) < 1.5)) continue;
    // Flights along z (treads across x) stand at rot 0; along x, a quarter turn.
    plan.items.push({ id: uid('i'), type: 'stairsU', x, z, rot: u.along === 'y' ? 0 : 90 });
  }
  // A sofa or a counter along a wall, drawn in the wall pen, pairs with that wall's face into a "wall" lying flat
  // against it: no house has two walls that close.
  dropHuggingWalls(plan);
  // Short walls touching nothing are leftovers (dimension ticks, labels): drop them.
  const degree = new Map<string, number>();
  for (const w of plan.walls) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  plan.walls = plan.walls.filter((w) => {
    const a = plan.nodes.find((n) => n.id === w.a)!;
    const b = plan.nodes.find((n) => n.id === w.b)!;
    const isolated = degree.get(w.a) === 1 && degree.get(w.b) === 1;
    return !(isolated && Math.hypot(b.x - a.x, b.z - a.z) < 1);
  });
  // Columns: small squares (18–42 cm) drawn in the wall lines with a diagonal or hatch inside, as plans draw
  // reinforced-concrete columns. They become columns standing the floor's full height.
  const rooms = findRooms(plan);
  degree.clear();
  for (const w of plan.walls) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  /** Where a candidate column stands: in an outside wall, at a junction of walls, or not in the walls at all. */
  const placeOf = (x: number, z: number, size: number): 'outside' | 'junction' | null => {
    let found: 'outside' | 'junction' | null = null;
    for (const w of plan.walls) {
      const a = plan.nodes.find((m) => m.id === w.a)!;
      const b = plan.nodes.find((m) => m.id === w.b)!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const L = Math.hypot(ex, ez) || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (L * L)));
      // On the wall's line: a column is drawn in the wall (flush with one face at most), not beside it.
      if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) > (w.thick ?? 0.15) / 2 + Math.min(size / 2, 0.08)) continue;
      const off = (w.thick ?? 0.15) / 2 + 0.15;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const inRoom = (k: number) =>
        rooms.some((r) => pointInPoly([mx - (ez / L) * off * k, mz + (ex / L) * off * k], r.poly));
      if (!inRoom(1) || !inRoom(-1)) return 'outside';
      if ([a, b].some((m) => Math.hypot(m.x - x, m.z - z) < 0.45 && (degree.get(m.id) ?? 0) >= 3)) found = 'junction';
    }
    return found;
  };
  // Columns stand on the structural grid: those in the outside walls set it, and one inside the building counts only
  // where it lines up with one of them (stair treads and fixtures drawn with diagonals don't).
  const found = findColumns(HM, VM, hatch)
    .map((c) => {
      const x = (c.x - ox) / 1000;
      const z = (oy - c.y) / 1000;
      return { x, z, size: c.size, place: placeOf(x, z, c.size) };
    })
    .filter((c) => c.place);
  const grid = found.filter((c) => c.place === 'outside');
  for (const c of found) {
    if (c.place !== 'outside' && !grid.some((g) => Math.abs(g.x - c.x) < 0.15 || Math.abs(g.z - c.z) < 0.15)) continue;
    if (plan.items.some((it) => Math.hypot(it.x - c.x, it.z - c.z) < 0.15)) continue;
    plan.items.push({ id: uid('i'), type: c.size > 0.26 ? 'columnLarge' : 'column', x: c.x, z: c.z, rot: 0 });
  }
  for (const pts of builtIns) {
    const b = curvedBuiltIn(pts);
    (plan.customs ??= {})[b.id] = b.def;
    plan.items.push({ id: uid('i'), type: `custom:${b.id}`, x: b.x, z: b.z, rot: 0 });
  }
  tidy(plan);
  return { plan, walls: plan.walls.length, openings: plan.openings.length };
}

/**
 * Squares and rectangles 150–600 mm a side with a diagonal or hatch stroke inside, as plans draw reinforced-concrete columns: a pair
 * of horizontal lines (often the wall's own faces, running on through the column) and two vertical lines across them
 * as far apart as they are.
 */
function findColumns(HM: Line[], VM: Line[], hatch: { x: number; y: number }[]) {
  const out: { x: number; y: number; size: number }[] = [];
  const verticals = [...VM].sort((m, n) => m.c - n.c);
  for (let i = 0; i < HM.length; i++) {
    const p = HM[i]!;
    for (let j = i + 1; j < HM.length; j++) {
      const q = HM[j]!;
      const gap = q.c - p.c;
      if (gap < 150) continue;
      if (gap > 450) break;
      const lo = Math.max(p.a, q.a) - 25;
      const hi = Math.min(p.b, q.b) + 25;
      if (hi - lo < 150) continue;
      const across = verticals.filter((v) => v.c >= lo && v.c <= hi && v.a <= p.c + 25 && v.b >= q.c - 25);
      for (const left of across) {
        // Square or rectangular (a column as wide as the wall and up to three times as long).
        const right = across.find((v) => {
          const w = v.c - left.c;
          return w >= 150 && w <= 600 && w <= gap * 3 && gap <= w * 3;
        });
        if (!right) continue;
        const [a, b] = [left.c, right.c];
        const cx = (a + b) / 2;
        const cy = (p.c + q.c) / 2;
        const inside = hatch.some((h) => h.x > a + 10 && h.x < b - 10 && h.y > p.c + 10 && h.y < q.c - 10);
        if (!inside || out.some((o) => Math.hypot(o.x - cx, o.y - cy) < Math.max(gap, b - a))) continue;
        out.push({ x: cx, y: cy, size: Math.max(gap, b - a) / 1000 });
      }
    }
  }
  return out;
}

/* ---------- Curved walls ---------- */

interface Chord {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  pen?: number;
}
type Pt = [number, number];

/** Distance from p to a polyline, and the nearest point on it. */
function nearestOn(p: Pt, line: Pt[]): { d: number; q: Pt } {
  let best = { d: Infinity, q: p };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)));
    const q: Pt = [a[0] + ex * t, a[1] + ey * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, q };
  }
  return best;
}

/**
 * Curved walls from curve chords (mm): chords that continue each other chain into curves; two curves that run side
 * by side a wall's thickness apart (60–350 mm over most of their length) are the faces of one curved wall. Returns its centre
 * line, resampled into pieces short enough to follow the curve, and its thickness.
 */
export function curvedWalls(
  chords: Chord[],
  singlePen: number | null = null,
): { pts: Pt[]; t: number; single?: true }[] {
  const chains: Pt[][] = [];
  /** The pen each curve is drawn with (its first piece's). */
  const penOf = new Map<Pt[], number | undefined>();
  for (const c of chords) {
    const last = chains[chains.length - 1];
    const end = last?.[last.length - 1];
    if (end && Math.hypot(end[0] - c.x1, end[1] - c.y1) < 10 && penOf.get(last!) === c.pen) last!.push([c.x2, c.y2]);
    else {
      const chain: Pt[] = [
        [c.x1, c.y1],
        [c.x2, c.y2],
      ];
      chains.push(chain);
      penOf.set(chain, c.pen);
    }
  }
  // Curves drawn as several pieces (a bend, then a long sweep) join end to end, in either direction.
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 10;
  for (let joined = true; joined;) {
    joined = false;
    for (const a of chains)
      for (const b of chains) {
        if (a === b || penOf.get(a) !== penOf.get(b)) continue;
        const [a0, a1, b0, b1] = [a[0]!, a[a.length - 1]!, b[0]!, b[b.length - 1]!];
        let tail: Pt[] | null = null;
        if (near(a1, b0)) tail = b.slice(1);
        else if (near(a1, b1)) tail = [...b].reverse().slice(1);
        else if (near(a0, b1)) {
          a.unshift(...b.slice(0, -1));
          tail = [];
        } else if (near(a0, b0)) {
          a.unshift(...[...b].reverse().slice(0, -1));
          tail = [];
        }
        if (!tail) continue;
        a.push(...tail);
        chains.splice(chains.indexOf(b), 1);
        joined = true;
        break;
      }
  }
  const length = (l: Pt[]) => l.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - l[i]![0], p[1] - l[i]![1]), 0);
  const curves = chains.filter((l) => length(l) >= 500);
  const used = new Set<Pt[]>();
  const cand: { a: Pt[]; b: Pt[]; t: number; mid: Pt[]; same: boolean }[] = [];
  for (const a of curves)
    for (const b of curves) {
      // Faces of one wall run its whole length: a short curve beside a long one (a bracket by a curved partition)
      // is something else.
      if (a === b || length(a) > length(b) || length(a) < length(b) * 0.5) continue;
      const ds = a.map((p) => nearestOn(p, b));
      const inBand = ds.filter((x) => x.d >= 60 && x.d <= 350);
      if (inBand.length < a.length * 0.7) continue;
      const sorted = inBand.map((x) => x.d).sort((p, q) => p - q);
      const t = sorted[Math.floor(sorted.length / 2)]!;
      // Only heavy (wall-pen or wall-layer) curves come here, so two that stay a wall's thickness apart over most of
      // their length are one wall, even where it swells (a curved wall with a niche or a built-in shelf).
      const mid = a
        .map((p, i): Pt | null =>
          ds[i]!.d >= 60 && ds[i]!.d <= 350 ? [(p[0] + ds[i]!.q[0]) / 2, (p[1] + ds[i]!.q[1]) / 2] : null,
        )
        .filter((p): p is Pt => !!p);
      cand.push({ a, b, t, mid, same: penOf.get(a) === penOf.get(b) });
    }
  // Both faces of a wall are drawn with one pen: such pairs first (a curved sliding door's track runs along the wall's
  // face in a finer pen, and would otherwise pair with it), then the closest.
  cand.sort((p, q) => Number(q.same) - Number(p.same) || p.t - q.t);
  const out: { pts: Pt[]; t: number; single?: true }[] = [];
  // Resample along a centre line: pieces of about a twelfth of it, 250–700 mm.
  const resample = (mid: Pt[]) => {
    const L = length(mid);
    const step = Math.max(250, Math.min(700, L / 12));
    const pts: Pt[] = [mid[0]!];
    let acc = 0;
    for (let i = 1; i < mid.length; i++) {
      acc += Math.hypot(mid[i]![0] - mid[i - 1]![0], mid[i]![1] - mid[i - 1]![1]);
      if (acc >= step || i === mid.length - 1) {
        pts.push(mid[i]!);
        acc = 0;
      }
    }
    return pts;
  };
  for (const c of cand) {
    if (used.has(c.a) || used.has(c.b) || c.mid.length < 2) continue;
    used.add(c.a);
    used.add(c.b);
    out.push({ pts: resample(c.mid), t: c.t });
  }
  // A curve in the walls' own pen with no partner is a thin curved wall drawn as one heavy stroke (a curved partition,
  // a niche): built 100 mm thick along it.
  if (singlePen !== null)
    for (const l of curves)
      if (!used.has(l) && (penOf.get(l) ?? 0) >= singlePen * 0.95 && length(l) >= 800) {
        used.add(l);
        out.push({ pts: resample(l), t: 100, single: true });
      }
  return out;
}

/* ---------- Noise: annotation, dimensions, stray clusters ---------- */

/** Layers that hold annotation, not construction (Vietnamese and English CAD habits). */
const ANNOTATION =
  /dim|kich ?thuoc|\bkt\b|text|chu|note|ghi ?chu|anno|grid|axis|truc|hatch|vat ?lieu|furn|noi ?that|thiet ?bi|title|khung|symbol|ky ?hieu|level|cao ?do|section|mat ?cat|leader|defpoints/;
const foldLayer = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase();

/**
 * The segments wall detection should look at: without annotation layers (a DXF's dimensions, text, grid, hatch,
 * furniture) and, in a PDF, without dimension chains — a line through two or more dimension ticks, and the
 * extension lines that end at a tick.
 */
function withoutAnnotation(d: Drawing): Segment[] {
  const segs = d.segs.filter((s) => {
    if (!s.layer) return true;
    const l = foldLayer(s.layer);
    return WALL_LAYER.test(l) || !ANNOTATION.test(l);
  });
  if (d.kind !== 'pdf') return segs;
  // Ticks: short oblique strokes, as scaleFromDimensions reads them.
  const ticks: Segment[] = [];
  for (const s of segs) {
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    if (s.curve || L < 0.5 || L > 12 || dx < L * 0.35 || dy < L * 0.35) continue;
    ticks.push(s);
  }
  if (ticks.length < 4) return segs;
  const numbers = d.texts.filter((t) => /^\s*\d{2,5}\s*$/.test(t.str));
  const tol = 0.8;
  const axisOf = (s: Segment) => (Math.abs(s.y2 - s.y1) < 0.2 ? 'H' : Math.abs(s.x2 - s.x1) < 0.2 ? 'V' : null);
  /** Ticks that cross the line (ends on both sides, centre on it): a hatch stroke only meets an edge from inside. */
  const crossing = (s: Segment, o: 'H' | 'V') =>
    ticks.filter((t) => {
      const [e1, e2] = o === 'H' ? [t.y1 - s.y1, t.y2 - s.y1] : [t.x1 - s.x1, t.x2 - s.x1];
      if (!(e1 * e2 < 0 && Math.abs(e1) > 0.2 && Math.abs(e2) > 0.2)) return false;
      const along = o === 'H' ? (t.x1 + t.x2) / 2 : (t.y1 + t.y2) / 2;
      const [lo, hi] =
        o === 'H' ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)] : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
      return along >= lo - tol && along <= hi + tol;
    });
  // A dimension line: ticks across it and a dimension figure written along it.
  const dimTicks = new Set<Segment>();
  const dims = new Set<Segment>();
  for (const s of segs) {
    const o = axisOf(s);
    if (!o) continue;
    const xs = crossing(s, o);
    if (xs.length < 2) continue;
    const [lo, hi] =
      o === 'H' ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)] : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
    // It stops just past its end ticks (a wall's edge runs on past a dimension that crosses it).
    const at = xs.map((t) => (o === 'H' ? (t.x1 + t.x2) / 2 : (t.y1 + t.y2) / 2));
    if (Math.min(...at) - lo > 4 || hi - Math.max(...at) > 4) continue;
    const labelled = numbers.some((t) => {
      const along = o === 'H' ? t.x : t.y;
      const across = o === 'H' ? Math.abs(t.y - s.y1) : Math.abs(t.x - s.x1);
      return along >= lo - t.h && along <= hi + t.h && across < t.h * 2.5;
    });
    if (!labelled) continue;
    dims.add(s);
    for (const t of xs) dimTicks.add(t);
  }
  if (!dims.size) return segs;
  // Extension lines end at a dimension tick, at right angles to its dimension line.
  return segs.filter((s) => {
    if (dims.has(s)) return false;
    const o = axisOf(s);
    if (!o) return true;
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    return !crossing(s, o).some((t) => {
      if (!dimTicks.has(t)) return false;
      const along = o === 'H' ? (t.x1 + t.x2) / 2 : (t.y1 + t.y2) / 2;
      const [lo, hi] =
        o === 'H' ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)] : [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
      return Math.min(along - lo, hi - along) < Math.max(tol * 3, L * 0.08);
    });
  });
}

/**
 * Repairs the wall graph before rooms are traced: a free end (a wall touching nothing there) runs on along its own
 * line to the first wall within reach, splitting that wall where it lands, so a partition drawn a little short — or
 * cut short by a cupboard, a column or a frame — still closes its room. Short stubs left touching nothing at one end
 * (frame and sill pieces read as walls) are then dropped. Works on the plan, in metres.
 */
function closeDangles(plan: Plan, reach = 1.0, curved: Set<string> = new Set()) {
  const node = (id: string) => plan.nodes.find((n) => n.id === id)!;
  const degree = () => {
    const d = new Map<string, number>();
    for (const w of plan.walls) for (const id of [w.a, w.b]) d.set(id, (d.get(id) ?? 0) + 1);
    return d;
  };
  const dropStubs = () => {
    const deg = degree();
    plan.walls = plan.walls.filter((w) => {
      const a = node(w.a);
      const b = node(w.b);
      const free = deg.get(w.a) === 1 || deg.get(w.b) === 1;
      return !(
        free &&
        !curved.has(w.id) &&
        Math.hypot(b.x - a.x, b.z - a.z) < 0.45 &&
        !plan.openings.some((o) => o.wall === w.id)
      );
    });
  };
  // Stubs first (under 45 cm, free at one end, no opening: frame and sill pieces read as walls), so a wall they hang
  // on is free to run on to the wall it was meant to meet.
  dropStubs();
  for (let pass = 0; pass < 2; pass++) {
    const deg = degree();
    for (const w of [...plan.walls]) {
      for (const end of ['a', 'b'] as const) {
        const id = w[end];
        if (deg.get(id) !== 1) continue;
        const n = node(id);
        const m = node(end === 'a' ? w.b : w.a);
        const L = Math.hypot(n.x - m.x, n.z - m.z);
        if (L < 0.05) continue;
        const ux = (n.x - m.x) / L;
        const uz = (n.z - m.z) / L;
        // Nearest wall the ray from n meets within reach (a little past a wall's ends counts: its thickness).
        let hit: { w: Wall; t: number; d: number } | null = null;
        for (const x of plan.walls) {
          if (x === w || x.a === id || x.b === id) continue;
          const a = node(x.a);
          const b = node(x.b);
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          const den = ux * ez - uz * ex;
          if (Math.abs(den) < 1e-6) continue;
          const d = ((a.x - n.x) * ez - (a.z - n.z) * ex) / den;
          const t = ((a.x - n.x) * uz - (a.z - n.z) * ux) / den;
          const len = Math.hypot(ex, ez);
          const slack = (x.thick ?? 0.15) / 2 / len;
          if (d < -0.02 || d > reach + (x.thick ?? 0.15) / 2 || t < -slack || t > 1 + slack) continue;
          if (!hit || d < hit.d) hit = { w: x, t, d };
        }
        if (!hit) continue;
        let target: PlanNode;
        if (hit.t < 0.02 || hit.t > 0.98) {
          // Landing at (or just past) the other wall's end: a free end there moves onto this one's line, so neither
          // wall slants; an end that is already joined is used as it is.
          target = node(hit.t < 0.5 ? hit.w.a : hit.w.b);
          const x = n.x + ux * hit.d;
          const z = n.z + uz * hit.d;
          const joinedAt = plan.walls.filter((q) => q.a === target.id || q.b === target.id).length;
          if (joinedAt === 1) {
            target.x = x;
            target.z = z;
          } else if (Math.hypot(target.x - x, target.z - z) > 0.02) {
            // That end is joined already: run this wall on to the corner point and close the step along the other
            // wall's line with a short piece.
            n.x = x;
            n.z = z;
            plan.walls.push({ id: uid('w'), a: n.id, b: target.id, thick: hit.w.thick });
            deg.set(id, 2);
            deg.set(target.id, (deg.get(target.id) ?? 0) + 1);
            continue;
          }
        } else {
          target = splitWall(plan, hit.w, hit.t);
          deg.set(target.id, 2);
        }
        // Re-point the free end onto the wall it reached.
        if (target.id !== id) {
          w[end] = target.id;
          plan.nodes = plan.nodes.filter((q) => q.id !== id || plan.walls.some((x) => x.a === id || x.b === id));
        }
        deg.set(id, 0);
        deg.set(target.id, (deg.get(target.id) ?? 0) + 1);
      }
    }
  }
  // Two free ends whose walls would meet at a corner just ahead of both (an L corner drawn with a gap, or cut by a
  // column): run both on to the corner.
  {
    const deg = degree();
    const free = plan.nodes.filter((n) => deg.get(n.id) === 1);
    const dirOf = (n: PlanNode): [number, number] | null => {
      const w = plan.walls.find((x) => x.a === n.id || x.b === n.id);
      if (!w) return null;
      const m = node(w.a === n.id ? w.b : w.a);
      const L = Math.hypot(n.x - m.x, n.z - m.z);
      return L < 0.05 ? null : [(n.x - m.x) / L, (n.z - m.z) / L];
    };
    const used = new Set<string>();
    for (const n1 of free)
      for (const n2 of free) {
        if (n1 === n2 || used.has(n1.id) || used.has(n2.id)) continue;
        const u1 = dirOf(n1);
        const u2 = dirOf(n2);
        if (!u1 || !u2) continue;
        const den = u1[0] * u2[1] - u1[1] * u2[0];
        if (Math.abs(den) < 0.9) continue;
        const d1 = ((n2.x - n1.x) * u2[1] - (n2.z - n1.z) * u2[0]) / den;
        const d2 = ((n2.x - n1.x) * u1[1] - (n2.z - n1.z) * u1[0]) / den;
        if (d1 < -0.05 || d1 > reach || d2 < -0.05 || d2 > reach) continue;
        const x = n1.x + u1[0] * d1;
        const z = n1.z + u1[1] * d1;
        n1.x = x;
        n1.z = z;
        for (const w of plan.walls) {
          if (w.a === n2.id) w.a = n1.id;
          if (w.b === n2.id) w.b = n1.id;
        }
        used.add(n1.id);
        used.add(n2.id);
      }
  }
  // A free end that reached no wall but stops right by another wall's end or corner (two walls offset where the
  // wall changes thickness, a corner drawn with a jog): join the two with a short piece.
  const deg = degree();
  for (const n of [...plan.nodes]) {
    if (deg.get(n.id) !== 1) continue;
    let best: PlanNode | null = null;
    let bd = 0.35;
    for (const m of plan.nodes) {
      if (m === n || !deg.get(m.id)) continue;
      const d = Math.hypot(m.x - n.x, m.z - n.z);
      // A jog runs square to the walls (a diagonal piece would cut a sliver off the room).
      if (Math.min(Math.abs(m.x - n.x), Math.abs(m.z - n.z)) > 0.03) continue;
      if (d < bd && !plan.walls.some((w) => (w.a === n.id && w.b === m.id) || (w.b === n.id && w.a === m.id))) {
        best = m;
        bd = d;
      }
    }
    if (!best) continue;
    const own = plan.walls.find((w) => w.a === n.id || w.b === n.id)!;
    plan.walls.push({ id: uid('w'), a: n.id, b: best.id, thick: own.thick });
    deg.set(n.id, 2);
    deg.set(best.id, (deg.get(best.id) ?? 0) + 1);
  }
  dropStubs();
  plan.walls = plan.walls.filter((w) => w.a !== w.b);
}

/** Removes small wall clusters that stand apart from the main building and have no openings. */
function dropStrayClusters(plan: Plan) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const w of plan.walls) parent.set(find(w.a), find(w.b));
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  const size = new Map<string, number>();
  const opened = new Set<string>();
  for (const w of plan.walls) {
    const a = nodes.get(w.a)!;
    const b = nodes.get(w.b)!;
    const r = find(w.a);
    size.set(r, (size.get(r) ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
    if (plan.openings.some((o) => o.wall === w.id)) opened.add(r);
  }
  const main = Math.max(0, ...size.values());
  plan.walls = plan.walls.filter((w) => {
    const r = find(w.a);
    const len = size.get(r) ?? 0;
    return len === main || opened.has(r) || len >= Math.max(3, main * 0.2);
  });
}

/**
 * Where one heavy pen clearly draws the walls (the cut walls, as TCVN draws them) and lighter pens above the fine one
 * draw other things in view (kitchen units, counters, a table's edge, a fence beyond the lot), a wall built only from
 * lighter-pen lines is kept only as a partition: its group of such walls meets real walls at two points or more and
 * leaves no free end in the room. A counter run out from a wall and ending in the room goes.
 */
function dropLightPenWalls(
  plan: Plan,
  H: Line[],
  V: Line[],
  penLen: Map<number, number>,
  wallPen: number | null,
  ox: number,
  oy: number,
  stairs: StairZone[] = [],
) {
  if (wallPen === null) return;
  const heavyPens = [...penLen].filter(([p]) => p >= wallPen - 1e-6);
  const heavyTotal = heavyPens.reduce((t, [, v]) => t + v, 0);
  const main = heavyPens.filter(([, v]) => v >= heavyTotal * 0.25).map(([p]) => p);
  if (!main.length) return;
  const top = Math.max(...main);
  const lighter = heavyPens.some(([p, v]) => p * 1.3 <= top && v >= heavyTotal * 0.1);
  if (!lighter) return;
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  /** The heaviest pen among the lines along a wall's faces. */
  const penOf = (w: Wall): number | null => {
    const a = nodes.get(w.a)!;
    const b = nodes.get(w.b)!;
    const horiz = Math.abs(b.z - a.z) < 0.01;
    const vert = Math.abs(b.x - a.x) < 0.01;
    if (!horiz && !vert) return null; // curved or slanted walls are not judged
    const lines = horiz ? H : V;
    const c = horiz ? oy - a.z * 1000 : a.x * 1000 + ox;
    const [s0, s1] = horiz
      ? [Math.min(a.x, b.x) * 1000 + ox, Math.max(a.x, b.x) * 1000 + ox]
      : [oy - Math.max(a.z, b.z) * 1000, oy - Math.min(a.z, b.z) * 1000];
    const half = ((w.thick ?? 0.15) * 1000) / 2;
    let best = -1;
    for (const l of lines) {
      if (Math.abs(Math.abs(l.c - c) - half) > 20) continue;
      const overlap = Math.min(l.b, s1) - Math.max(l.a, s0);
      if (overlap < Math.min(200, (s1 - s0) * 0.3)) continue;
      best = Math.max(best, l.pen ?? 0);
    }
    return best < 0 ? null : best;
  };
  const light = new Set(
    plan.walls
      .filter((w) => {
        const p = penOf(w);
        return p !== null && p * 1.25 < top;
      })
      .map((w) => w.id),
  );
  if (!light.size) return;
  // Light walls in a stair's zone (its outline, stringers, the well's edge) go whatever they touch.
  const inStair = (w: Wall) => {
    const a = nodes.get(w.a)!;
    const b = nodes.get(w.b)!;
    const [X, Y] = [((a.x + b.x) / 2) * 1000 + ox, oy - ((a.z + b.z) / 2) * 1000];
    return stairs.some((z) => X >= z.x0 - 500 && X <= z.x1 + 500 && Y >= z.y0 - 500 && Y <= z.y1 + 500);
  };
  // Never the outside walls: a stair often runs along one.
  const xs = plan.nodes.map((n) => n.x);
  const zs = plan.nodes.map((n) => n.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const outside = (w: Wall) => {
    const a = nodes.get(w.a)!;
    const b = nodes.get(w.b)!;
    const on = (v: number, e: number) => Math.abs(v - e) < 0.15;
    return (
      (on(a.x, minX) && on(b.x, minX)) ||
      (on(a.x, maxX) && on(b.x, maxX)) ||
      (on(a.z, minZ) && on(b.z, minZ)) ||
      (on(a.z, maxZ) && on(b.z, maxZ))
    );
  };
  const stairDrop = new Set(
    plan.walls
      .filter((w) => light.has(w.id) && inStair(w) && !outside(w) && !plan.openings.some((o) => o.wall === w.id))
      .map((w) => w.id),
  );
  if (stairDrop.size) {
    plan.walls = plan.walls.filter((w) => !stairDrop.has(w.id));
    plan.openings = plan.openings.filter((o) => !stairDrop.has(o.wall));
  }
  // Peel light walls that end free in the room, again and again (a counter's run, then the piece it hung from).
  const drop = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    const degree = new Map<string, number>();
    for (const w of plan.walls)
      if (!drop.has(w.id)) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const w of plan.walls)
      if (light.has(w.id) && !drop.has(w.id) && (degree.get(w.a) === 1 || degree.get(w.b) === 1)) {
        drop.add(w.id);
        changed = true;
      }
  }
  // What is left of the light walls must hang between real walls: a group touching them at fewer than two points is a
  // closed piece of furniture fixed to one wall.
  const heavyAt = new Set(plan.walls.filter((w) => !light.has(w.id)).flatMap((w) => [w.a, w.b]));
  const seen = new Set<string>();
  for (const start of plan.walls) {
    if (!light.has(start.id) || drop.has(start.id) || seen.has(start.id)) continue;
    const group: Wall[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length) {
      const w = queue.pop()!;
      group.push(w);
      for (const o of plan.walls)
        if (
          light.has(o.id) &&
          !drop.has(o.id) &&
          !seen.has(o.id) &&
          [o.a, o.b].some((id) => id === w.a || id === w.b)
        ) {
          seen.add(o.id);
          queue.push(o);
        }
    }
    const anchors = new Set(group.flatMap((w) => [w.a, w.b]).filter((id) => heavyAt.has(id)));
    if (anchors.size < 2) for (const w of group) drop.add(w.id);
  }
  plan.walls = plan.walls.filter((w) => !drop.has(w.id));
  plan.openings = plan.openings.filter((o) => !drop.has(o.wall));
}

/**
 * Drops walls lying against a longer parallel wall (less than 0.2 m between their faces over most of their length):
 * furniture along a wall (a sofa, a counter) whose lines paired with the wall's face. Then the short stubs that held
 * them (their ends in the room now free) go too.
 */
function dropHuggingWalls(plan: Plan) {
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  type Ax = { w: Wall; horiz: boolean; c: number; a: number; b: number };
  const axis = (w: Wall): Ax | null => {
    const p = nodes.get(w.a)!;
    const q = nodes.get(w.b)!;
    if (Math.abs(p.z - q.z) < 0.01) return { w, horiz: true, c: p.z, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) };
    if (Math.abs(p.x - q.x) < 0.01) return { w, horiz: false, c: p.x, a: Math.min(p.z, q.z), b: Math.max(p.z, q.z) };
    return null;
  };
  /** Length of the straight run a wall is part of (collinear walls joined end to end). */
  const runOf = (x: Ax, all: Ax[]) => {
    let [a, b] = [x.a, x.b];
    for (let grown = true; grown;) {
      grown = false;
      for (const y of all)
        if (y.horiz === x.horiz && Math.abs(y.c - x.c) < 0.02 && y.b >= a - 0.02 && y.a <= b + 0.02) {
          if (y.a < a - 1e-6 || y.b > b + 1e-6) {
            a = Math.min(a, y.a);
            b = Math.max(b, y.b);
            grown = true;
          }
        }
    }
    return b - a;
  };
  const dropped = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    const all = plan.walls
      .filter((w) => !dropped.has(w.id))
      .map(axis)
      .filter((x): x is Ax => !!x);
    for (const x of all) {
      if (x.b - x.a < 0.5) continue;
      const mine = runOf(x, all);
      const hugged = all.some((y) => {
        if (y === x || y.horiz !== x.horiz) return false;
        const gap = Math.abs(y.c - x.c) - ((x.w.thick ?? 0.15) + (y.w.thick ?? 0.15)) / 2;
        if (gap > 0.2 || Math.abs(y.c - x.c) < 0.02) return false;
        const overlap = Math.min(x.b, y.b) - Math.max(x.a, y.a);
        return overlap >= (x.b - x.a) * 0.7 && runOf(y, all) > mine + 0.3;
      });
      if (hugged) {
        dropped.add(x.w.id);
        changed = true;
        break;
      }
    }
  }
  if (!dropped.size) return;
  const freed = new Set(plan.walls.filter((w) => dropped.has(w.id)).flatMap((w) => [w.a, w.b]));
  plan.walls = plan.walls.filter((w) => !dropped.has(w.id));
  // Stubs left hanging where the furniture was: short walls with a free end that lost their neighbour.
  for (let changed = true; changed;) {
    changed = false;
    const degree = new Map<string, number>();
    for (const w of plan.walls) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const w of plan.walls) {
      const p = nodes.get(w.a)!;
      const q = nodes.get(w.b)!;
      const free = [w.a, w.b].filter((id) => degree.get(id) === 1);
      if (!free.length || !free.some((id) => freed.has(id)) || Math.hypot(q.x - p.x, q.z - p.z) > 0.5) continue;
      plan.walls = plan.walls.filter((x) => x !== w);
      for (const id of [w.a, w.b]) freed.add(id);
      changed = true;
      break;
    }
  }
  // Where the furniture met a wall, that wall was split: join its two pieces again (when straight, alike and plain).
  for (const id of freed) {
    const two = plan.walls.filter((w) => w.a === id || w.b === id);
    if (two.length !== 2) continue;
    const [u, v] = two as [Wall, Wall];
    if (u.thick !== v.thick || plan.openings.some((o) => o.wall === u.id || o.wall === v.id)) continue;
    const p = nodes.get(u.a === id ? u.b : u.a)!;
    const q = nodes.get(v.a === id ? v.b : v.a)!;
    const m = nodes.get(id)!;
    const cross = (m.x - p.x) * (q.z - p.z) - (m.z - p.z) * (q.x - p.x);
    if (Math.abs(cross) / (Math.hypot(q.x - p.x, q.z - p.z) || 1) > 0.01) continue;
    plan.walls = plan.walls.filter((w) => w !== v);
    if (u.a === id) u.a = q.id;
    else u.b = q.id;
  }
  const ids = new Set(plan.walls.map((w) => w.id));
  plan.openings = plan.openings.filter((o) => ids.has(o.wall));
}

/** A run of stair treads, in drawing millimetres: its box and the direction the flight climbs along. */
interface StairZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 'x' when the treads are vertical lines (the flight runs along x), 'y' when horizontal. */
  along: 'x' | 'y';
  /** Five treads or more in a row: a flight on its own. Shorter runs count only beside one (a U stair's other half). */
  strong: boolean;
}

/**
 * Flights of stairs: five or more parallel lines 0.5–1.6 m long sharing their ends (the treads, as wide as the flight)
 * and spaced 18–35 cm apart, one after another. Close pairs (a sliding door's tracks) are not treads.
 */
function stairZones(H: Line[], V: Line[]): StairZone[] {
  const out: StairZone[] = [];
  for (const [lines, along] of [
    [H, 'y'],
    [V, 'x'],
  ] as const) {
    const cand = lines.filter((l) => l.b - l.a >= 500 && l.b - l.a <= 1600);
    const used = new Set<Line>();
    for (const l of cand) {
      if (used.has(l)) continue;
      const group = cand.filter((m) => !used.has(m) && Math.abs(m.a - l.a) < 80 && Math.abs(m.b - l.b) < 80);
      // One line per position (a tread drawn twice counts once), in order across the flight.
      const cs = [...new Set(group.map((m) => Math.round(m.c / 40)))].map((v) => v * 40).sort((p, q) => p - q);
      // The longest run of steady spacing.
      let best: number[] = [];
      let run: number[] = [cs[0]!];
      for (let i = 1; i < cs.length; i++) {
        const gap = cs[i]! - cs[i - 1]!;
        if (gap >= 180 && gap <= 350) run.push(cs[i]!);
        else {
          if (run.length > best.length) best = run;
          run = [cs[i]!];
        }
      }
      if (run.length > best.length) best = run;
      if (best.length < 3) continue;
      for (const m of group) used.add(m);
      const a = Math.min(...group.map((m) => m.a));
      const b = Math.max(...group.map((m) => m.b));
      const c0 = best[0]!;
      const c1 = best[best.length - 1]!;
      // H lines (horizontal treads): c is y, the span runs in x; the flight climbs along y.
      const strong = best.length >= 5;
      out.push(
        along === 'y'
          ? { x0: a, x1: b, y0: c0, y1: c1, along, strong }
          : { x0: c0, x1: c1, y0: a, y1: b, along, strong },
      );
    }
  }
  return out;
}

/**
 * U stairs: two flights of the same direction side by side (their treads end to end across the stair, at most 30 cm
 * apart) over the same stretch. Returns the box round both.
 */
function uStairs(zones: StairZone[]): StairZone[] {
  const out: StairZone[] = [];
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const p = zones[i]!;
      const q = zones[j]!;
      if (p.along !== q.along || (!p.strong && !q.strong)) continue;
      const [pa, pb, qa, qb] = p.along === 'y' ? [p.x0, p.x1, q.x0, q.x1] : [p.y0, p.y1, q.y0, q.y1];
      const [ps, pe, qs, qe] = p.along === 'y' ? [p.y0, p.y1, q.y0, q.y1] : [p.x0, p.x1, q.x0, q.x1];
      const side = Math.max(qa - pb, pa - qb);
      const overlap = Math.min(pe, qe) - Math.max(ps, qs);
      if (side < -50 || side > 300 || overlap < Math.min(pe - ps, qe - qs) * 0.5) continue;
      out.push({
        x0: Math.min(p.x0, q.x0),
        x1: Math.max(p.x1, q.x1),
        y0: Math.min(p.y0, q.y0),
        y1: Math.max(p.y1, q.y1),
        along: p.along,
        strong: true,
      });
    }
  return out;
}

/**
 * A curved built-in from the curve its front follows (plan metres): thin wooden panels 2.2 m high along each piece of
 * the curve, as one object (footprint round the curve, origin at its middle) the planner can move or delete.
 */
function curvedBuiltIn(pts: [number, number][]): { id: string; def: CustomDef; x: number; z: number } {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  const H = 2.2;
  const parts: CustomPart[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = [pts[i - 1]![0] - cx, pts[i - 1]![1] - cz];
    const [bx, bz] = [pts[i]![0] - cx, pts[i]![1] - cz];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.02) continue;
    parts.push({
      shape: 'box',
      w: L + 0.02,
      h: H,
      d: 0.05,
      x: (ax + bx) / 2,
      y: H / 2,
      z: (az + bz) / 2,
      // A box's length runs along x; turning it by θ about y points it along (cos θ, −sin θ).
      ry: (Math.atan2(-(bz - az), bx - ax) * 180) / Math.PI,
      material: 'wood',
      color: '#d8c3a0',
    });
  }
  return {
    id: uid('curve'),
    def: {
      name: 'Curved built-in (as drawn)',
      w: Math.max(0.1, x1 - x0),
      d: Math.max(0.1, z1 - z0),
      h: H,
      room: 'Bedroom',
      parts,
    },
    x: cx,
    z: cz,
  };
}
