import { Color3, LinesMesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { carrierShapes, obbOverlap, type OBB } from "./collision";
import {
  CONTAINER,
  CONTAINER_CENTRE_ON_GROUND,
  DROP_X,
  GATE_Z,
  GRAVITY,
  SPREADER_HALF_H,
  box,
  darkGrey,
  inStack,
  isTop,
  nearestFreeSlot,
  pickableObstacles,
  pickables,
  reservedSlots,
  slots,
  staticObs,
  surfaceUnder,
  type Pickable,
} from "./world";

// ---------- Controls ----------

// spread: -1 closes the T-bars, +1 opens them (optional, defaults to 0)
export type Controls = { throttle: number; steer: number; hoist: number; shift: number; spread?: number };
export const NO_CONTROLS: Controls = { throttle: 0, steer: 0, hoist: 0, shift: 0 };

// ---------- Tuning ----------

export const SPREADER_MAX_Y = 11.5;
const TROLLEY_Y = 12.0;
const HOIST_RATE = 1.2;
const SHIFT_RATE = 0.8;
const SHIFT_MAX = 1.2;
const LOCK_HEIGHT_TOL = 0.3;
const LOCK_X_TOL = 0.3;
const LOCK_Z_TOL = 0.6;
const LOCK_YAW_TOL = 0.06;
const SWAY_DAMP = 0.6;
const SWAY_MAX = 0.8;
// The two T-bars open and close to fit the container length; they only twistlock when fitted to it
const SPREAD_MIN = 5.0;
const SPREAD_MAX = 7.0;
const SPREAD_RATE = 0.8;
const SPREAD_LOCK_TOL = 0.3;

const MAX_FWD = 6;
const MAX_REV = 2;
const ACCEL = 2.0;
const DECEL = 3.5;
const MAX_STEER = 0.55;
const STEER_RATE = 1.8;
const WHEELBASE = 10;
const CARRIER_X_MIN = -110;
const CARRIER_X_MAX = 30;
const CARRIER_Z_LIMIT = 110;

const ROPE_CORNERS: [number, number][] = [
  [-1.3, -3.1],
  [1.3, -3.1],
  [-1.3, 3.1],
  [1.3, 3.1],
];
const TROLLEY_CORNERS: [number, number][] = [
  [-0.9, -1.2],
  [0.9, -1.2],
  [-0.9, 1.2],
  [0.9, 1.2],
];

export type CarrierMats = {
  body: StandardMaterial;
  glass: StandardMaterial;
  hiVis: StandardMaterial;
  skin: StandardMaterial;
};

// Every straddle in the yard. Used for carrier-to-carrier collision.
export const straddles: Straddle[] = [];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Everything a carrier can hit: static parts, loose or stacked containers, and other carriers' solid legs and cab
function obstaclesFor(self: Straddle): OBB[] {
  const out: OBB[] = [...staticObs, ...pickableObstacles()];
  for (const o of straddles) {
    if (o !== self) out.push(...o.shapes());
  }
  return out;
}

// ---------- Carrier body ----------

function buildBody(root: TransformNode, mats: CarrierMats, scene: Scene): void {
  const part = (name: string, size: { width: number; height: number; depth: number }, m: StandardMaterial, pos: [number, number, number]) => {
    const mesh = box(name, size, m, pos);
    mesh.parent = root;
  };
  for (const x of [-3.2, 3.2]) {
    for (const z of [-5, 5]) {
      part("leg", { width: 0.7, height: 10.5, depth: 0.7 }, mats.body, [x, 5.25, z]);
      const wheel = MeshBuilder.CreateCylinder("wheel", { diameter: 1.3, height: 0.6, tessellation: 16 }, scene);
      wheel.rotation = new Vector3(0, 0, Math.PI / 2);
      wheel.position = new Vector3(x, 0.65, z);
      wheel.material = darkGrey;
      wheel.parent = root;
    }
  }
  for (const z of [-5, 5]) {
    part("beam", { width: 7.2, height: 1.0, depth: 0.8 }, mats.body, [0, 10.8, z]);
  }
}

// Cab on the driver side, glazed on the inner and front faces, with a seated driver
function buildCab(root: TransformNode, mats: CarrierMats, scene: Scene): void {
  const part = (name: string, size: { width: number; height: number; depth: number }, m: StandardMaterial, pos: [number, number, number]) => {
    const mesh = box(name, size, m, pos);
    mesh.parent = root;
  };
  part("cabFloor", { width: 1.4, height: 0.1, depth: 1.8 }, mats.glass, [-2.7, 6.2, 3.9]);
  part("cabRoof", { width: 1.4, height: 0.1, depth: 1.8 }, mats.body, [-2.7, 7.8, 3.9]);
  part("cabRear", { width: 1.4, height: 1.6, depth: 0.1 }, mats.glass, [-2.7, 7.0, 3.0]);
  part("cabOuter", { width: 0.1, height: 1.6, depth: 1.8 }, mats.body, [-3.35, 7.0, 3.9]);
  part("cabInner", { width: 0.05, height: 1.6, depth: 1.8 }, mats.glass, [-2.05, 7.0, 3.9]);
  part("cabFront", { width: 1.4, height: 1.6, depth: 0.05 }, mats.glass, [-2.7, 7.0, 4.85]);
  part("seat", { width: 0.6, height: 0.5, depth: 0.6 }, darkGrey, [-2.95, 6.45, 3.9]);
  part("driverTorso", { width: 0.45, height: 0.7, depth: 0.35 }, mats.hiVis, [-2.95, 6.95, 3.9]);
  const head = MeshBuilder.CreateSphere("driverHead", { diameter: 0.3, segments: 10 }, scene);
  head.material = mats.skin;
  head.parent = root;
  head.position = new Vector3(-2.95, 7.4, 3.9);
}

// ---------- The carrier ----------

export class Straddle {
  readonly root: TransformNode;
  readonly spreaderNode: TransformNode;
  private readonly ropes: LinesMesh[] = [];
  private readonly bars: TransformNode[] = [];

  speed = 0;
  steer = 0;
  heading: number;
  spreaderY = SPREADER_MAX_Y;
  spread = CONTAINER.depth; // distance between the two T-bars, in metres
  shiftX = 0;
  swayX = 0;
  swayZ = 0;
  blockedTime = 0;
  held: Pickable | null = null;
  private swayVX = 0;
  private swayVZ = 0;

  constructor(scene: Scene, mats: CarrierMats, x: number, z: number, heading = 0) {
    this.root = new TransformNode("carrier", scene);
    this.root.position = new Vector3(x, 0, z);
    this.heading = heading;
    this.root.rotation.y = heading;
    buildBody(this.root, mats, scene);
    buildCab(this.root, mats, scene);

    this.spreaderNode = new TransformNode("spreader", scene);
    this.spreaderNode.parent = this.root;
    // Two T-bars, each a beam across the container with a stem up to the ropes
    for (let i = 0; i < 2; i++) {
      const bar = new TransformNode(`tbar${i}`, scene);
      bar.parent = this.spreaderNode;
      box("tbarBeam", { width: 2.6, height: 0.4, depth: 0.5 }, darkGrey, [0, 0, 0]).parent = bar;
      box("tbarStem", { width: 0.4, height: 0.6, depth: 0.4 }, darkGrey, [0, 0.5, 0]).parent = bar;
      this.bars.push(bar);
    }
    this.updateBars();

    for (let i = 0; i < ROPE_CORNERS.length; i++) {
      const line = MeshBuilder.CreateLines(`rope${i}`, { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene);
      line.color = new Color3(0.1, 0.1, 0.1);
      line.parent = this.root;
      this.ropes.push(line);
    }
    straddles.push(this);
  }

  localToWorld(p: Vector3): Vector3 {
    this.root.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(p, this.root.getWorldMatrix());
  }

  worldToLocal(p: Vector3): Vector3 {
    this.root.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(p, this.root.getWorldMatrix().clone().invert());
  }

  spreaderWorld(): Vector3 {
    return this.localToWorld(new Vector3(this.shiftX + this.swayX, this.spreaderY, this.swayZ));
  }

  // Solid parts of this carrier, for other carriers to collide with
  shapes(): OBB[] {
    return carrierShapes(this.root.position.x, this.root.position.z, this.heading);
  }

  // Lowest the spreader can go: on the surface beneath it, or on the stack under the held container
  minSpreaderY(): number {
    const w = this.spreaderWorld();
    if (this.held) {
      return surfaceUnder(w.x, w.z, this.held) + SPREADER_HALF_H + CONTAINER.height;
    }
    return surfaceUnder(w.x, w.z, null) + SPREADER_HALF_H;
  }

  spreadFits(): boolean {
    return Math.abs(this.spread - CONTAINER.depth) < SPREAD_LOCK_TOL;
  }

  canLock(p: Pickable): boolean {
    return this.spreadFits() && this.envelopeFits(p);
  }

  // Position and height of the spreader over the container, ignoring the bar spread
  envelopeFits(p: Pickable): boolean {
    if (p.attached || !isTop(p)) return false;
    const top = p.mesh.position.y + CONTAINER_CENTRE_ON_GROUND;
    const c = this.worldToLocal(p.mesh.position);
    const yawOff = wrapAngle(p.mesh.rotation.y - this.root.rotation.y);
    return (
      Math.abs(this.spreaderY - (top + SPREADER_HALF_H)) < LOCK_HEIGHT_TOL &&
      Math.abs(c.x - (this.shiftX + this.swayX)) < LOCK_X_TOL &&
      Math.abs(c.z - this.swayZ) < LOCK_Z_TOL &&
      Math.abs(yawOff) < LOCK_YAW_TOL
    );
  }

  attach(p: Pickable): void {
    this.held = p;
    p.attached = true;
    p.vy = 0;
    p.mesh.parent = this.spreaderNode;
    p.mesh.position = new Vector3(0, -(SPREADER_HALF_H + CONTAINER_CENTRE_ON_GROUND), 0);
    p.mesh.rotation = Vector3.Zero();
  }

  release(): void {
    const p = this.held;
    if (!p) return;
    const w = this.localToWorld(
      new Vector3(this.shiftX + this.swayX, this.spreaderY - SPREADER_HALF_H - CONTAINER_CENTRE_ON_GROUND, this.swayZ),
    );
    p.mesh.parent = null;
    p.mesh.position = w;
    p.mesh.rotation = new Vector3(0, this.root.rotation.y, 0);
    p.attached = false;
    p.vy = 0;
    this.held = null;
  }

  step(dt: number, c: Controls): void {
    // Speed and steering
    const target = c.throttle >= 0 ? c.throttle * MAX_FWD : c.throttle * MAX_REV;
    const braking = target === 0 || (this.speed !== 0 && Math.sign(target) !== Math.sign(this.speed));
    const rate = braking ? DECEL : ACCEL;
    const prevSpeed = this.speed;
    this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    const longAccel = (this.speed - prevSpeed) / dt;
    this.steer += clamp(c.steer * MAX_STEER - this.steer, -STEER_RATE * dt, STEER_RATE * dt);

    // Proposed pose from the bicycle model
    const newHeading = this.heading + ((this.speed * Math.tan(this.steer)) / WHEELBASE) * dt;
    const x0 = this.root.position.x;
    const z0 = this.root.position.z;
    const xFull = clamp(x0 + Math.sin(newHeading) * this.speed * dt, CARRIER_X_MIN, CARRIER_X_MAX);
    const zFull = clamp(z0 + Math.cos(newHeading) * this.speed * dt, -CARRIER_Z_LIMIT, CARRIER_Z_LIMIT);

    // Collision: try the full move, then slide on each axis, otherwise hold position
    const obs = obstaclesFor(this);
    const free = (x: number, z: number, h: number): boolean =>
      carrierShapes(x, z, h).every((sh) => !obs.some((o) => obbOverlap(sh, o)));
    let nx = x0;
    let nz = z0;
    let nh = this.heading;
    if (free(xFull, zFull, newHeading)) {
      [nx, nz, nh] = [xFull, zFull, newHeading];
    } else if (free(xFull, z0, newHeading)) {
      [nx, nz, nh] = [xFull, z0, newHeading];
    } else if (free(x0, zFull, newHeading)) {
      [nx, nz, nh] = [x0, zFull, newHeading];
    } else {
      this.speed = 0;
    }

    const moved = nx !== x0 || nz !== z0;
    this.blockedTime = !moved && Math.abs(target) > 0.01 ? this.blockedTime + dt : 0;

    this.root.position.x = nx;
    this.root.position.z = nz;
    this.heading = nh;
    this.root.rotation.y = nh;

    // Hoist and side shift
    this.spread = clamp(this.spread + (c.spread ?? 0) * SPREAD_RATE * dt, SPREAD_MIN, SPREAD_MAX);
    // Assist: over a container with the bars not being driven, close them onto its length
    if (!this.held && (c.spread ?? 0) === 0 && pickables.some((p) => this.envelopeFits(p))) {
      this.spread += clamp(CONTAINER.depth - this.spread, -SPREAD_RATE * dt, SPREAD_RATE * dt);
    }
    this.spreaderY += c.hoist * HOIST_RATE * dt;
    this.shiftX = clamp(this.shiftX + c.shift * SHIFT_RATE * dt, -SHIFT_MAX, SHIFT_MAX);

    // Sway: damped pendulum on the ropes, driven by carrier acceleration
    const latAccel = (this.speed * this.speed * Math.tan(this.steer)) / WHEELBASE;
    const w2 = GRAVITY / Math.max(1, TROLLEY_Y - this.spreaderY);
    this.swayVX += (-w2 * this.swayX - SWAY_DAMP * this.swayVX - latAccel) * dt;
    this.swayX = clamp(this.swayX + this.swayVX * dt, -SWAY_MAX, SWAY_MAX);
    this.swayVZ += (-w2 * this.swayZ - SWAY_DAMP * this.swayVZ - longAccel) * dt;
    this.swayZ = clamp(this.swayZ + this.swayVZ * dt, -SWAY_MAX, SWAY_MAX);

    this.spreaderY = clamp(this.spreaderY, this.minSpreaderY(), SPREADER_MAX_Y);
    this.spreaderNode.position = new Vector3(this.shiftX + this.swayX, this.spreaderY, this.swayZ);
    this.updateBars();
    this.updateRopes();
  }

  // Place each T-bar at its end of the spread
  private updateBars(): void {
    this.bars.forEach((bar, i) => {
      bar.position = new Vector3(0, 0, i === 0 ? -this.spread / 2 : this.spread / 2);
    });
  }

  private updateRopes(): void {
    const px = this.shiftX + this.swayX;
    const pz = this.swayZ;
    const scene = this.root.getScene();
    ROPE_CORNERS.forEach(([cx, cz], i) => {
      const [tx, tz] = TROLLEY_CORNERS[i];
      MeshBuilder.CreateLines(
        `rope${i}`,
        {
          points: [
            new Vector3(tx, TROLLEY_Y, tz),
            new Vector3(px + cx, this.spreaderY + SPREADER_HALF_H, pz + Math.sign(cz) * this.spread / 2),
          ],
          instance: this.ropes[i],
        },
        scene,
      );
    });
  }
}

// Lock or release the twistlocks. Locking picks the first container that lines up under the spreader.
export function toggleLock(s: Straddle): void {
  if (s.held) {
    s.release();
    return;
  }
  const p = pickables.find((cand) => s.canLock(cand));
  if (p) s.attach(p);
}

// ---------- Autopilot ----------

// Open or close the T-bars towards the container length
function fitSpread(s: Straddle): number {
  return clamp((CONTAINER.depth - s.spread) * 2, -1, 1);
}

// Drive to a point and align heading to tyaw. Non-strict points only need to be reached; strict ones must be stopped at.
export function driveTowards(
  s: Straddle,
  tx: number,
  tz: number,
  tyaw: number,
  strict: boolean,
): { controls: Controls; arrived: boolean } {
  const dx = tx - s.root.position.x;
  const dz = tz - s.root.position.z;
  const dist = Math.hypot(dx, dz);
  const along = dx * Math.sin(s.heading) + dz * Math.cos(s.heading);
  const reverse = along < -0.2;
  const bearing = wrapAngle(Math.atan2(dx, dz) - s.heading);
  const yawErr = wrapAngle(tyaw - s.heading);
  const far = dist > 2.5;
  let steer = clamp((far ? bearing : yawErr) * 1.2, -1, 1);
  if (reverse) steer = -steer;

  const yawOk = Math.abs(yawErr) < 0.04;
  const settled = Math.abs(s.speed) < 0.2 && Math.abs(s.swayX) < 0.08 && Math.abs(s.swayZ) < 0.08;
  const arrived = strict ? dist < 0.35 && yawOk && settled : dist < 2;
  let mag = far ? 0.7 : clamp(dist * 0.6, 0.08, 0.4);
  if (arrived) mag = 0;
  else if (strict && dist < 0.35 && !yawOk) mag = 0.1;
  const throttle = reverse ? -mag : mag;
  return { controls: { throttle, steer, hoist: 0, shift: 0 }, arrived };
}

// Nearest top container in this crane's drop zone that nobody else has claimed. Each crane has its own zone.
export function pickNext(craneZ: number, claimant: object): Pickable | null {
  for (const p of pickables) {
    const pos = p.mesh.position;
    if (p.attached || p.claimedBy || p.vy !== 0) continue;
    if (inStack(pos)) continue;
    if (Math.abs(pos.x - DROP_X) > 3 || Math.abs(pos.z - craneZ) > 9) continue;
    if (!isTop(p)) continue;
    p.claimedBy = claimant;
    return p;
  }
  return null;
}

type Waypoint = { x: number; z: number; yaw: number; strict: boolean };
type Phase = "idle" | "driveToPick" | "lowerPick" | "liftPick" | "driveToStack" | "lowerSlot";

export class Autopilot {
  private phase: Phase = "idle";
  private target: Pickable | null = null;
  private route: Waypoint[] = [];
  private waited = 0;
  private recoverTime = 0;
  private recoverSteer = 0;
  private slotIndex = -1;

  constructor(
    readonly s: Straddle,
    readonly craneZ: number,
    readonly approachSign: number,
  ) {}

  private giveUp(): void {
    if (this.target) this.target.claimedBy = null;
    this.target = null;
    this.route = [];
    this.waited = 0;
    this.phase = "idle";
  }

  private drive(): { controls: Controls; done: boolean } {
    const wp = this.route[0];
    const r = driveTowards(this.s, wp.x, wp.z, wp.yaw, wp.strict);
    if (r.arrived) {
      this.route.shift();
      return { controls: NO_CONTROLS, done: this.route.length === 0 };
    }
    return { controls: r.controls, done: false };
  }

  step(dt: number): Controls {
    return { ...this.decide(dt), spread: fitSpread(this.s) };
  }

  private decide(dt: number): Controls {
    const s = this.s;

    // Stuck against something: back off and turn for a moment
    if (this.recoverTime > 0) {
      this.recoverTime -= dt;
      return { throttle: -0.6, steer: this.recoverSteer, hoist: 0, shift: 0 };
    }
    if (s.blockedTime > 1.0) {
      this.recoverTime = 1.5;
      this.recoverSteer = Math.random() < 0.5 ? -1 : 1;
      s.blockedTime = 0;
      return NO_CONTROLS;
    }

    switch (this.phase) {
      case "idle": {
        const p = pickNext(this.craneZ, this);
        if (!p) return NO_CONTROLS;
        this.target = p;
        this.route = [
          { x: DROP_X, z: GATE_Z, yaw: 0, strict: false },
          { x: DROP_X, z: this.craneZ + this.approachSign * 14, yaw: 0, strict: false },
          { x: DROP_X, z: this.craneZ, yaw: 0, strict: true },
        ];
        this.phase = "driveToPick";
        return NO_CONTROLS;
      }

      case "driveToPick": {
        if (!this.target || this.target.attached) {
          this.giveUp();
          return NO_CONTROLS;
        }
        const d = this.drive();
        if (d.done) {
          this.phase = "lowerPick";
          this.waited = 0;
        }
        return d.controls;
      }

      case "lowerPick": {
        const p = this.target;
        if (!p || p.attached) {
          this.giveUp();
          return NO_CONTROLS;
        }
        if (s.canLock(p)) {
          s.attach(p);
          this.phase = "liftPick";
          return NO_CONTROLS;
        }
        // Lower until the spreader meets the surface; if it still won't line up, give up after a while
        if (s.spreaderY > s.minSpreaderY() + 0.02) return { ...NO_CONTROLS, hoist: -1 };
        this.waited += dt;
        if (this.waited > 4) this.giveUp();
        return NO_CONTROLS;
      }

      case "liftPick": {
        if (s.spreaderY < SPREADER_MAX_Y - 0.5) return { ...NO_CONTROLS, hoist: 1 };
        const idx = nearestFreeSlot(s.root.position);
        if (idx < 0) return NO_CONTROLS; // yard full: hold the container
        this.slotIndex = idx;
        reservedSlots.add(idx);
        const slot = slots[idx];
        this.route = [
          { x: DROP_X, z: GATE_Z, yaw: 0, strict: false },
          { x: slot.x, z: GATE_Z, yaw: 0, strict: false },
          { x: slot.x, z: slot.z, yaw: 0, strict: true },
        ];
        this.phase = "driveToStack";
        return NO_CONTROLS;
      }

      case "driveToStack": {
        const d = this.drive();
        if (d.done) this.phase = "lowerSlot";
        return d.controls;
      }

      case "lowerSlot": {
        if (s.spreaderY > s.minSpreaderY() + 0.02) return { ...NO_CONTROLS, hoist: -1 };
        s.release();
        reservedSlots.delete(this.slotIndex);
        if (this.target) this.target.claimedBy = null;
        this.target = null;
        this.phase = "idle";
        return NO_CONTROLS;
      }
    }
    return NO_CONTROLS;
  }
}
