/**
 * Spiral stairs as plans draw them: arcs round one centre (the column, the inner and outer edges of the treads) with
 * the treads as straight lines radiating from that centre. Found from the geometry when the plan is built, so the
 * stair stands where it is drawn and climbs from its first drawn tread.
 */
import { FURNITURE } from '../room/catalog';
import { uid, type Item, type Plan } from '../room/plan';
import { inRegion, type Drawing, type Region, type Segment } from './drawing';

export interface FoundSpiral {
  /** Centre in plan metres. */
  x: number;
  z: number;
  /** Outer radius in metres. */
  r: number;
  /** Plan angle of the first tread (radians from +z towards +x), the treads climbing towards larger angles. */
  start: number;
}

/** Circle through three points, or null when they are (nearly) in line. */
function circle(a: [number, number], b: [number, number], c: [number, number]) {
  const D = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(D) < 1e-9) return null;
  const sq = (p: [number, number]) => p[0] * p[0] + p[1] * p[1];
  const x = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / D;
  const y = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / D;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

export function findSpiralStairs(d: Drawing, region: Region): FoundSpiral[] {
  const k = d.mmPerUnit ?? 1;
  const unit = 1000 / k; // drawing units per metre
  const inside = (s: Segment) => inRegion(region, s.x1, s.y1) && inRegion(region, s.x2, s.y2);
  // Arcs: runs of curve pieces joined end to start, fitted with a circle.
  const arcs: { x: number; y: number; r: number }[] = [];
  let run: Segment[] = [];
  const flush = () => {
    if (run.length >= 3) {
      // Three points spread along the arc (a closed circle ends where it starts, so not its two ends).
      const [p, q, r] = [0, 1 / 3, 2 / 3].map((f) => run[Math.floor(f * run.length)]!);
      const c = circle([p.x1, p.y1], [q.x1, q.y1], [r.x1, r.y1]);
      if (c && c.r > 0.03 * unit && c.r < 1.7 * unit) arcs.push(c);
    }
    run = [];
  };
  for (const s of d.segs) {
    if (!s.curve || !inside(s)) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    if (prev && Math.hypot(s.x1 - prev.x2, s.y1 - prev.y2) > 0.02 * unit) flush();
    run.push(s);
  }
  flush();

  // Arcs sharing a centre.
  const groups: { x: number; y: number; radii: number[] }[] = [];
  for (const a of arcs) {
    const g = groups.find((q) => Math.hypot(q.x - a.x, q.y - a.y) < 0.05 * unit);
    if (g) g.radii.push(a.r);
    else groups.push({ x: a.x, y: a.y, radii: [a.r] });
  }
  const straight = d.segs.filter((s) => !s.curve && inside(s));
  const out: FoundSpiral[] = [];
  for (const g of groups) {
    const outer = Math.max(...g.radii.filter((r) => r >= 0.5 * unit && r <= 1.5 * unit), 0);
    const inner = Math.min(...g.radii);
    if (!outer || outer / inner < 2.5) continue;
    // Treads: straight lines on a ray from the centre, from near the column out to the outer edge.
    const angles: number[] = [];
    for (const s of straight) {
      const r1 = Math.hypot(s.x1 - g.x, s.y1 - g.y);
      const r2 = Math.hypot(s.x2 - g.x, s.y2 - g.y);
      const lo = Math.min(r1, r2);
      const hi = Math.max(r1, r2);
      if (lo > 0.5 * outer || hi < 0.55 * outer || hi > 1.1 * outer) continue;
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
      const off = Math.abs((s.x2 - s.x1) * (g.y - s.y1) - (s.y2 - s.y1) * (g.x - s.x1)) / L;
      if (off > 0.04 * outer) continue;
      const far = r1 > r2 ? [s.x1, s.y1] : [s.x2, s.y2];
      // Plan angle from +z towards +x (plan z runs down, the drawing's y up).
      const a = Math.atan2(far[0]! - g.x, -(far[1]! - g.y));
      if (!angles.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.05)) angles.push(a);
    }
    if (angles.length < 5) continue;
    // The drawn treads run round part of the circle: the first is the one after the widest gap.
    const sorted = angles.map((a) => (a + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    let gap = -1;
    let start = sorted[0]!;
    sorted.forEach((a, i) => {
      const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + Math.PI * 2;
      if (next - a > gap) {
        gap = next - a;
        start = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]!;
      }
    });
    out.push({
      x: ((g.x - region.x0) * k) / 1000,
      z: ((region.y1 - g.y) * k) / 1000,
      r: (outer * k) / 1000,
      start,
    });
  }
  return out;
}

/** Puts the spiral stairs found into the plan (the catalogue size nearest the drawn one). Returns how many. */
export function placeSpirals(plan: Plan, found: FoundSpiral[]): number {
  let n = 0;
  for (const f of found) {
    if (plan.items.some((it) => /^stairs/.test(it.type) && Math.hypot(it.x - f.x, it.z - f.z) < f.r)) continue;
    const sizes = ['stairsSpiral', 'stairsSpiralM', 'stairsSpiralL'];
    const type = sizes.sort((a, b) => Math.abs(FURNITURE[a]!.w - 2 * f.r) - Math.abs(FURNITURE[b]!.w - 2 * f.r))[0]!;
    // Tread 0 climbs from local +z; turning the piece by rot puts it at plan angle -rot.
    const rot = Math.round((((-f.start * 180) / Math.PI) % 360) + 360) % 360;
    const it: Item = { id: uid('i'), type, x: f.x, z: f.z, rot };
    plan.items.push(it);
    n++;
  }
  return n;
}
