// 2D oriented-box collision in the XZ plane. Yaw follows Babylon's rotation.y convention.

export type OBB = { x: number; z: number; hx: number; hz: number; yaw: number };

export function obbCorners(o: OBB): [number, number][] {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const pts: [number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * o.hx;
      const lz = sz * o.hz;
      pts.push([o.x + lx * c + lz * s, o.z - lx * s + lz * c]);
    }
  }
  return pts;
}

// Separating-axis test for two oriented rectangles
export function obbOverlap(a: OBB, b: OBB): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const reach = Math.hypot(a.hx, a.hz) + Math.hypot(b.hx, b.hz);
  if (dx * dx + dz * dz > reach * reach) return false;

  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes: [number, number][] = [
    [Math.cos(a.yaw), -Math.sin(a.yaw)],
    [Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(b.yaw), -Math.sin(b.yaw)],
    [Math.sin(b.yaw), Math.cos(b.yaw)],
  ];
  for (const [nx, nz] of axes) {
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const [x, z] of ca) {
      const d = x * nx + z * nz;
      amin = Math.min(amin, d);
      amax = Math.max(amax, d);
    }
    for (const [x, z] of cb) {
      const d = x * nx + z * nz;
      bmin = Math.min(bmin, d);
      bmax = Math.max(bmax, d);
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

// Solid parts of a straddle carrier: the four legs and the cab.
// The chassis and beams are high above containers, so they are not solid.
export function carrierShapes(x: number, z: number, heading: number): OBB[] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const place = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c] as const;
  const shapes: OBB[] = [];
  for (const lx of [-3.2, 3.2]) {
    for (const lz of [-5, 5]) {
      const [px, pz] = place(lx, lz);
      shapes.push({ x: px, z: pz, hx: 0.35, hz: 0.35, yaw: heading });
    }
  }
  const [cx, cz] = place(-2.7, 4.0);
  shapes.push({ x: cx, z: cz, hx: 0.7, hz: 0.9, yaw: heading });
  return shapes;
}
