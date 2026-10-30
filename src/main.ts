import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

// ---------- Setup ----------

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.62, 0.74, 0.86, 1);

new HemisphericLight("sky", new Vector3(0, 1, 0), scene).intensity = 0.75;
new DirectionalLight("sun", new Vector3(-0.4, -1, 0.3), scene).intensity = 0.6;

function material(name: string, r: number, g: number, b: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  return m;
}

function box(
  name: string,
  size: { width: number; height: number; depth: number },
  m: StandardMaterial,
  pos: [number, number, number],
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, size, scene);
  mesh.material = m;
  mesh.position = new Vector3(...pos);
  return mesh;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- Constants ----------

const GRAVITY = 9.81;
const CONTAINER = { width: 2.44, height: 2.6, depth: 6.06 };
const CONTAINER_CENTRE_ON_GROUND = CONTAINER.height / 2; // 1.3

const SPREADER_HALF_H = 0.2;
const SPREADER_MAX_Y = 11.5;
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

const MAX_FWD = 6; // m/s, about 22 km/h
const MAX_REV = 2;
const ACCEL = 2.0;
const DECEL = 3.5;
const MAX_STEER = 0.55;
const STEER_RATE = 1.8;
const WHEELBASE = 10;
const CARRIER_X_MIN = -110;
const CARRIER_X_MAX = 24;
const CARRIER_Z_LIMIT = 110;

// Stacking grid in the yard
const STACK_COLS = 6;
const STACK_ROWS = 8;
const STACK_X0 = -30;
const STACK_Z0 = -48;
const PITCH_X = 2.5;
const PITCH_Z = CONTAINER.depth;
const MAX_TIER = 3;

const APRON_X0 = 20;
const APRON_X1 = 32;
const SHIP_X = 47;

// ---------- Environment ----------

const yard = MeshBuilder.CreateGround("yard", { width: 140, height: 240 }, scene);
yard.position.x = -50; // spans x -120..20
yard.material = material("asphalt", 0.32, 0.32, 0.34);

const apron = MeshBuilder.CreateBox("apron", { width: APRON_X1 - APRON_X0, height: 0.4, depth: 240 }, scene);
apron.position = new Vector3((APRON_X0 + APRON_X1) / 2, -0.2, 0);
apron.material = material("concrete", 0.6, 0.6, 0.6);

const water = MeshBuilder.CreateGround("water", { width: 160, height: 240 }, scene);
water.position = new Vector3(APRON_X1 + 80, -0.6, 0);
water.material = material("water", 0.1, 0.3, 0.45);

// Stack grid markers
const slotMat = material("slotMark", 0.45, 0.45, 0.42);
type Slot = { x: number; z: number };
const slots: Slot[] = [];
for (let row = 0; row < STACK_ROWS; row++) {
  for (let col = 0; col < STACK_COLS; col++) {
    const slot = { x: STACK_X0 + col * PITCH_X, z: STACK_Z0 + row * PITCH_Z };
    slots.push(slot);
    box("slotMark", { width: 2.4, height: 0.02, depth: PITCH_Z - 0.2 }, slotMat, [slot.x, 0.01, slot.z]);
  }
}
const reservedSlots = new Set<number>();

function lightMast(x: number, z: number): void {
  const pole = MeshBuilder.CreateCylinder("mast", { diameter: 0.6, height: 30, tessellation: 8 }, scene);
  pole.position = new Vector3(x, 15, z);
  pole.material = material("pole", 0.7, 0.7, 0.72);
  box("lamp", { width: 3, height: 0.6, depth: 1.5 }, material("lampHead", 0.95, 0.95, 0.85), [x, 30.2, z]);
}
for (const [x, z] of [
  [-110, -100],
  [-110, 100],
  [14, -100],
  [14, 100],
  [-60, -110],
  [-60, 110],
]) {
  lightMast(x, z);
}

box("office", { width: 16, height: 8, depth: 10 }, material("office", 0.9, 0.9, 0.88), [-95, 4, -70]);

// ---------- Containers ----------

const CONTAINER_COLOURS: [number, number, number][] = [
  [0.1, 0.35, 0.7],
  [0.85, 0.5, 0.1],
  [0.2, 0.6, 0.3],
  [0.7, 0.7, 0.72],
  [0.75, 0.15, 0.1],
];
const containerMats = CONTAINER_COLOURS.map(([r, g, b], i) => material(`containerMat${i}`, r, g, b));

function addContainer(name: string, colour: number, pos: Vector3, yaw = 0): Mesh {
  const c = MeshBuilder.CreateBox(name, CONTAINER, scene);
  c.material = containerMats[colour % containerMats.length];
  c.position = pos;
  c.rotation.y = yaw;
  return c;
}

// ---------- Ship ----------

const SHIP_DECK = 4;
const hullMat = material("hull", 0.14, 0.2, 0.3);
const hullStripe = material("hullStripe", 0.7, 0.1, 0.1);
const shipWhite = material("shipWhite", 0.95, 0.95, 0.95);
const funnelRed = material("funnelRed", 0.8, 0.12, 0.1);
const funnelBlack = material("funnelBlack", 0.08, 0.08, 0.08);
const deckGrey = material("deckGrey", 0.5, 0.5, 0.5);

// Pointed bow: plan-view outline extruded upward, then lowered so the deck sits at SHIP_DECK
const hullOutline = [
  new Vector3(SHIP_X - 12, 0, -75),
  new Vector3(SHIP_X + 12, 0, -75),
  new Vector3(SHIP_X + 12, 0, 45),
  new Vector3(SHIP_X, 0, 75),
  new Vector3(SHIP_X - 12, 0, 45),
];
const hull = MeshBuilder.ExtrudePolygon("hull", { shape: hullOutline, depth: 8, sideOrientation: Mesh.DOUBLESIDE }, scene);
hull.position.y = -4;
hull.material = hullMat;

// Red boot-top stripe on both sides
box("stripeL", { width: 0.2, height: 1.2, depth: 120 }, hullStripe, [SHIP_X - 12.05, -2.4, 0]);
box("stripeR", { width: 0.2, height: 1.2, depth: 120 }, hullStripe, [SHIP_X + 12.05, -2.4, 0]);

// Deck plate under the containers
box("deck", { width: 23, height: 0.1, depth: 148 }, deckGrey, [SHIP_X, SHIP_DECK + 0.05, 0]).isPickable = false;

// Accommodation block aft, with bridge windows band and wheelhouse
box("accom", { width: 12, height: 8, depth: 16 }, shipWhite, [SHIP_X, SHIP_DECK + 4, -66]);
box("accomTop", { width: 10, height: 1, depth: 12 }, shipWhite, [SHIP_X, SHIP_DECK + 8.5, -66]);
box("bridgeWindows", { width: 9, height: 0.8, depth: 12.1 }, material("windows", 0.15, 0.25, 0.35), [SHIP_X, SHIP_DECK + 7.5, -66]);

// Funnel with black cap
const funnel = MeshBuilder.CreateCylinder("funnel", { diameter: 3.2, height: 5, tessellation: 14 }, scene);
funnel.position = new Vector3(SHIP_X, SHIP_DECK + 10.5 + 2.5, -66);
funnel.material = funnelRed;
const funnelCap = MeshBuilder.CreateCylinder("funnelCap", { diameter: 3.3, height: 0.8, tessellation: 14 }, scene);
funnelCap.position = new Vector3(SHIP_X, SHIP_DECK + 15 + 0.4, -66);
funnelCap.material = funnelBlack;

// Mast with cross-trees forward of the accommodation
const shipMast = MeshBuilder.CreateCylinder("shipMast", { diameter: 0.3, height: 10, tessellation: 6 }, scene);
shipMast.position = new Vector3(SHIP_X, SHIP_DECK + 10 + 5, -58);
shipMast.material = shipWhite;
box("crossTree", { width: 4, height: 0.2, depth: 0.2 }, shipWhite, [SHIP_X, SHIP_DECK + 13, -58]);

// Deck containers, two tiers, nine columns
let shipBoxCount = 0;
for (let col = 0; col < 9; col++) {
  for (let row = 0; row < 14; row++) {
    for (let tier = 0; tier < 2; tier++) {
      const x = SHIP_X - 10 + col * 2.5;
      const z = -50 + row * CONTAINER.depth;
      const y = SHIP_DECK + CONTAINER.height * (tier + 0.5);
      addContainer(`shipBox${shipBoxCount++}`, col + row + tier, new Vector3(x, y, z));
    }
  }
}

// ---------- Cranes ----------

const craneRed = material("craneRed", 0.85, 0.15, 0.1);
const craneYellow = material("craneYellow", 0.95, 0.75, 0.1);
const darkGrey = material("dark", 0.15, 0.15, 0.15);

// Ship-to-shore cranes on the apron, boom reaching over the ship
function shipToShoreCrane(z: number): void {
  for (const x of [23, 31]) {
    for (const dz of [-1.5, 1.5]) {
      box("craneLeg", { width: 1.2, height: 42, depth: 1.2 }, craneRed, [x, 21, z + dz]);
    }
  }
  box("craneTop", { width: 9, height: 1.6, depth: 3.4 }, craneRed, [27, 42, z]);
  box("boom", { width: 40, height: 1.6, depth: 1.6 }, craneYellow, [43, 43, z]);
  box("trolley", { width: 2.4, height: 1.2, depth: 2.4 }, darkGrey, [47, 44.6, z]);
}
for (const z of [-40, 0, 40]) shipToShoreCrane(z);

// Rubber-tyred gantry over the yard block
function rubberTyredGantry(z: number): void {
  for (const x of [-62, -40]) {
    for (const dz of [-4, 4]) {
      box("rtgLeg", { width: 1, height: 12, depth: 1 }, craneYellow, [x, 6, z + dz]);
    }
  }
  for (const dz of [-4, 4]) {
    box("rtgBeam", { width: 23, height: 1.2, depth: 0.8 }, craneYellow, [-51, 12.6, z + dz]);
  }
}
rubberTyredGantry(0);

// Yard block, three columns, two high
for (const x of [-52.5, -50, -47.5]) {
  for (let row = 0; row < 20; row++) {
    for (let tier = 0; tier < 2; tier++) {
      const z = -60 + row * CONTAINER.depth;
      const y = CONTAINER_CENTRE_ON_GROUND + tier * CONTAINER.height;
      addContainer("yardBox", row + tier, new Vector3(x, y, z));
    }
  }
}

// ---------- Pickable containers ----------

type Pickable = { mesh: Mesh; vy: number; attached: boolean; claimedBy: Straddle | null };
const pickables: Pickable[] = [];

function addPickable(pos: Vector3, colour: number, yaw = 0): void {
  const mesh = addContainer(`pickable${pickables.length}`, colour, pos, yaw);
  pickables.push({ mesh, vy: 0, attached: false, claimedBy: null });
}
addPickable(new Vector3(0, CONTAINER_CENTRE_ON_GROUND, -22), 1);
addPickable(new Vector3(26, CONTAINER_CENTRE_ON_GROUND, -8), 3);
for (const x of [25, 28]) {
  for (const z of [60, 60 + CONTAINER.depth, 60 + 2 * CONTAINER.depth]) {
    addPickable(new Vector3(x, CONTAINER_CENTRE_ON_GROUND, z), (x + z) % 5);
  }
}

// ---------- Container helpers ----------

function surfaceUnder(x: number, z: number, exclude: Pickable | null): number {
  let top = 0;
  for (const o of pickables) {
    if (o === exclude || o.attached) continue;
    const op = o.mesh.position;
    if (Math.abs(op.x - x) < CONTAINER.width / 2 && Math.abs(op.z - z) < CONTAINER.depth / 2) {
      top = Math.max(top, op.y + CONTAINER_CENTRE_ON_GROUND);
    }
  }
  return top;
}

function isTop(p: Pickable): boolean {
  const pos = p.mesh.position;
  for (const o of pickables) {
    if (o === p || o.attached) continue;
    const op = o.mesh.position;
    if (
      Math.abs(op.x - pos.x) < CONTAINER.width / 2 &&
      Math.abs(op.z - pos.z) < CONTAINER.depth / 2 &&
      op.y > pos.y + 0.5
    ) {
      return false;
    }
  }
  return true;
}

function occupancy(slot: Slot, exclude: Pickable | null): number {
  return pickables.filter(
    (p) =>
      p !== exclude &&
      !p.attached &&
      Math.abs(p.mesh.position.x - slot.x) < 1.0 &&
      Math.abs(p.mesh.position.z - slot.z) < 2.5,
  ).length;
}

function slotNear(x: number, z: number, exclude: Pickable): Slot | null {
  for (const s of slots) {
    if (Math.abs(x - s.x) < 1.0 && Math.abs(z - s.z) < 2.5 && occupancy(s, exclude) < MAX_TIER) {
      return s;
    }
  }
  return null;
}

function inStack(pos: Vector3): boolean {
  return (
    pos.x > STACK_X0 - CONTAINER.width / 2 &&
    pos.x < STACK_X0 + (STACK_COLS - 1) * PITCH_X + CONTAINER.width / 2 &&
    pos.z > STACK_Z0 - CONTAINER.depth / 2 &&
    pos.z < STACK_Z0 + (STACK_ROWS - 1) * PITCH_Z + CONTAINER.depth / 2
  );
}

function nearestFreeSlot(from: Vector3): number {
  let best = -1;
  let bestD = Infinity;
  slots.forEach((s, i) => {
    if (reservedSlots.has(i) || occupancy(s, null) >= MAX_TIER) return;
    const d = Math.hypot(s.x - from.x, s.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// Containers not held fall under gravity and settle on whatever is below them
function stepContainers(dt: number): void {
  for (const p of pickables) {
    if (p.attached) continue;
    const m = p.mesh;
    p.vy -= GRAVITY * dt;
    m.position.y += p.vy * dt;
    const surf = surfaceUnder(m.position.x, m.position.z, p);
    if (m.position.y - CONTAINER_CENTRE_ON_GROUND <= surf) {
      const slot = slotNear(m.position.x, m.position.z, p);
      if (slot) {
        m.position.x = slot.x;
        m.position.z = slot.z;
        m.rotation.y = 0;
      }
      const landed = surfaceUnder(m.position.x, m.position.z, p);
      m.position.y = landed + CONTAINER_CENTRE_ON_GROUND;
      p.vy = 0;
    }
  }
}

// ---------- Straddle carrier ----------

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

const tyre = material("tyre", 0.08, 0.08, 0.08);
const cabGlass = material("glass", 0.75, 0.88, 0.95);
cabGlass.alpha = 0.22;
cabGlass.backFaceCulling = false;
cabGlass.specularColor = new Color3(0.2, 0.2, 0.2);
const hiVis = material("hiVis", 0.95, 0.6, 0.05);
const skin = material("skin", 0.85, 0.65, 0.5);
const bodyRed = material("bodyRed", 0.85, 0.15, 0.1);
const bodyYellow = material("bodyYellow", 0.95, 0.75, 0.1);
const bodyBlue = material("bodyBlue", 0.15, 0.4, 0.8);

type Controls = { throttle: number; steer: number; hoist: number; shift: number };
const NO_CONTROLS: Controls = { throttle: 0, steer: 0, hoist: 0, shift: 0 };

function buildCarrierBody(root: TransformNode, bodyMat: StandardMaterial): void {
  const part = (name: string, size: { width: number; height: number; depth: number }, m: StandardMaterial, pos: [number, number, number]) => {
    const mesh = MeshBuilder.CreateBox(name, size, scene);
    mesh.material = m;
    mesh.parent = root;
    mesh.position = new Vector3(...pos);
  };
  part("chassis", { width: 7, height: 0.6, depth: 11 }, darkGrey, [0, 0.9, 0]);
  for (const x of [-3.2, 3.2]) {
    for (const z of [-5, 5]) {
      part("leg", { width: 0.7, height: 9.3, depth: 0.7 }, bodyMat, [x, 5.85, z]);
    }
  }
  for (const z of [-5, 5]) {
    part("beam", { width: 7.2, height: 1.0, depth: 0.8 }, bodyMat, [0, 10.8, z]);
  }
  // Cab shell: solid floor, roof, rear and outer wall; glass on the inner and front sides
  part("cabFloor", { width: 1.4, height: 0.1, depth: 1.8 }, bodyMat, [-2.7, 6.2, 3.9]);
  part("cabRoof", { width: 1.4, height: 0.1, depth: 1.8 }, bodyMat, [-2.7, 7.8, 3.9]);
  part("cabRear", { width: 1.4, height: 1.6, depth: 0.1 }, bodyMat, [-2.7, 7.0, 3.0]);
  part("cabOuter", { width: 0.1, height: 1.6, depth: 1.8 }, bodyMat, [-3.35, 7.0, 3.9]);
  part("cabInner", { width: 0.05, height: 1.6, depth: 1.8 }, cabGlass, [-2.05, 7.0, 3.9]);
  part("cabFront", { width: 1.4, height: 1.6, depth: 0.05 }, cabGlass, [-2.7, 7.0, 4.85]);

  // Driver seated in the cab, facing the centreline
  part("seat", { width: 0.6, height: 0.5, depth: 0.6 }, darkGrey, [-2.95, 6.45, 3.9]);
  part("driverTorso", { width: 0.45, height: 0.7, depth: 0.35 }, hiVis, [-2.95, 6.95, 3.9]);
  const head = MeshBuilder.CreateSphere("driverHead", { diameter: 0.3, segments: 10 }, scene);
  head.material = skin;
  head.parent = root;
  head.position = new Vector3(-2.95, 7.4, 3.9);
  for (const x of [-3.2, 3.2]) {
    for (const z of [-5, 5]) {
      const wheel = MeshBuilder.CreateCylinder("wheel", { diameter: 1.3, height: 0.6, tessellation: 16 }, scene);
      wheel.rotation = new Vector3(0, 0, Math.PI / 2);
      wheel.position = new Vector3(x, 0.65, z);
      wheel.material = tyre;
      wheel.parent = root;
    }
  }
}

class Straddle {
  readonly root: TransformNode;
  readonly spreaderNode: TransformNode;
  private readonly ropes: LinesMesh[];

  speed = 0;
  steer = 0;
  heading: number;
  spreaderY = SPREADER_MAX_Y;
  shiftX = 0;
  swayX = 0;
  swayZ = 0;
  private swayVX = 0;
  private swayVZ = 0;
  private prevSpeed = 0;
  held: Pickable | null = null;

  constructor(x: number, z: number, bodyMat: StandardMaterial, startHeading = 0) {
    this.root = new TransformNode("carrier", scene);
    this.root.position = new Vector3(x, 0, z);
    this.heading = startHeading;
    this.root.rotation.y = startHeading;
    buildCarrierBody(this.root, bodyMat);

    this.spreaderNode = new TransformNode("spreader", scene);
    this.spreaderNode.parent = this.root;
    const sb = MeshBuilder.CreateBox("spreaderBox", { width: 2.6, height: 0.4, depth: 6.2 }, scene);
    sb.material = darkGrey;
    sb.parent = this.spreaderNode;

    this.ropes = ROPE_CORNERS.map((_corner, i) => {
      const line = MeshBuilder.CreateLines(`rope${i}`, { points: [Vector3.Zero(), Vector3.Zero()] }, scene);
      line.color = new Color3(0.1, 0.1, 0.1);
      line.parent = this.root;
      return line;
    });
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

  // Lowest height the spreader can reach: on top of the container below, or the held container's bottom
  minSpreaderY(): number {
    const w = this.spreaderWorld();
    if (this.held) {
      return surfaceUnder(w.x, w.z, this.held) + SPREADER_HALF_H + CONTAINER.height;
    }
    return surfaceUnder(w.x, w.z, null) + SPREADER_HALF_H;
  }

  canLock(p: Pickable): boolean {
    if (p.attached || !isTop(p)) return false;
    const abs = p.mesh.position;
    const top = abs.y + CONTAINER_CENTRE_ON_GROUND;
    const c = this.worldToLocal(abs);
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
    // Drive
    const target = c.throttle >= 0 ? c.throttle * MAX_FWD : c.throttle * MAX_REV;
    const braking = target === 0 || (this.speed !== 0 && Math.sign(target) !== Math.sign(this.speed));
    const rate = braking ? DECEL : ACCEL;
    this.prevSpeed = this.speed;
    this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    const longAccel = (this.speed - this.prevSpeed) / dt;

    this.steer += clamp(c.steer * MAX_STEER - this.steer, -STEER_RATE * dt, STEER_RATE * dt);
    this.heading += ((this.speed * Math.tan(this.steer)) / WHEELBASE) * dt;
    this.root.rotation.y = this.heading;
    this.root.position.x = clamp(
      this.root.position.x + Math.sin(this.heading) * this.speed * dt,
      CARRIER_X_MIN,
      CARRIER_X_MAX,
    );
    this.root.position.z = clamp(
      this.root.position.z + Math.cos(this.heading) * this.speed * dt,
      -CARRIER_Z_LIMIT,
      CARRIER_Z_LIMIT,
    );

    // Hoist and side shift
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
    this.updateRopes();
  }

  private updateRopes(): void {
    const px = this.shiftX + this.swayX;
    const pz = this.swayZ;
    ROPE_CORNERS.forEach(([cx, cz], i) => {
      const [tx, tz] = TROLLEY_CORNERS[i];
      MeshBuilder.CreateLines(
        `rope${i}`,
        {
          points: [
            new Vector3(tx, TROLLEY_Y, tz),
            new Vector3(px + cx, this.spreaderY + SPREADER_HALF_H, pz + cz),
          ],
          instance: this.ropes[i],
        },
        scene,
      );
    });
  }
}

function toggleLock(s: Straddle): void {
  if (s.held) {
    s.release();
    return;
  }
  const p = pickables.find((cand) => s.canLock(cand));
  if (p) s.attach(p);
}

// ---------- Autopilot for the other straddle carriers ----------

function pickNext(s: Straddle): Pickable | null {
  let best: Pickable | null = null;
  let bestD = Infinity;
  for (const p of pickables) {
    if (p.attached || p.claimedBy || p.vy !== 0 || inStack(p.mesh.position)) continue;
    const d = Vector3.Distance(p.mesh.position, s.root.position);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) best.claimedBy = s;
  return best;
}

// Simple drive-to-point controller: steers toward the point, then aligns heading to tyaw
function driveTowards(
  s: Straddle,
  tx: number,
  tz: number,
  tyaw: number,
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
  const arrived =
    dist < 0.35 && yawOk && Math.abs(s.speed) < 0.2 && Math.abs(s.swayX) < 0.08 && Math.abs(s.swayZ) < 0.08;
  let mag = far ? 0.7 : clamp(dist * 0.6, 0.08, 0.4);
  if (arrived) mag = 0;
  else if (dist < 0.35 && !yawOk) mag = 0.1;
  const throttle = reverse ? -mag : mag;
  return { controls: { throttle, steer, hoist: 0, shift: 0 }, arrived };
}

type Phase = "idle" | "toPick" | "lowerPick" | "liftPick" | "toSlot" | "lowerSlot";

class Autopilot {
  private phase: Phase = "idle";
  private target: Pickable | null = null;
  private slotIndex = -1;
  private waited = 0;

  constructor(readonly s: Straddle) {}

  private giveUp(): void {
    if (this.target) this.target.claimedBy = null;
    this.target = null;
    this.phase = "idle";
  }

  step(dt: number): Controls {
    const s = this.s;
    switch (this.phase) {
      case "idle": {
        this.target = pickNext(s);
        if (this.target) this.phase = "toPick";
        return NO_CONTROLS;
      }
      case "toPick": {
        const p = this.target!;
        const abs = p.mesh.position;
        const r = driveTowards(s, abs.x, abs.z, p.mesh.rotation.y);
        if (r.arrived) {
          this.phase = "lowerPick";
          this.waited = 0;
        }
        return r.controls;
      }
      case "lowerPick": {
        const p = this.target!;
        const want = p.mesh.position.y + CONTAINER_CENTRE_ON_GROUND + SPREADER_HALF_H;
        if (s.spreaderY > want + 0.02) return { ...NO_CONTROLS, hoist: -1 };
        if (s.canLock(p)) {
          toggleLock(s);
          this.phase = "liftPick";
          return NO_CONTROLS;
        }
        this.waited += dt;
        if (this.waited > 4) this.giveUp();
        return NO_CONTROLS;
      }
      case "liftPick": {
        if (s.spreaderY < SPREADER_MAX_Y - 1) return { ...NO_CONTROLS, hoist: 1 };
        const idx = nearestFreeSlot(s.root.position);
        if (idx < 0) return NO_CONTROLS; // stack full: hold the container
        this.slotIndex = idx;
        reservedSlots.add(idx);
        this.phase = "toSlot";
        return NO_CONTROLS;
      }
      case "toSlot": {
        const slot = slots[this.slotIndex];
        const r = driveTowards(s, slot.x, slot.z, 0);
        if (r.arrived) this.phase = "lowerSlot";
        return r.controls;
      }
      case "lowerSlot": {
        if (s.spreaderY > s.minSpreaderY() + 0.02) return { ...NO_CONTROLS, hoist: -1 };
        toggleLock(s); // release onto the stack
        reservedSlots.delete(this.slotIndex);
        if (this.target) this.target.claimedBy = null;
        this.target = null;
        this.phase = "idle";
        return NO_CONTROLS;
      }
    }
  }
}

// ---------- Carriers ----------

const player = new Straddle(0, -30, bodyRed, 0);
const aiYellow = new Straddle(12, 40, bodyYellow, 0);
const aiBlue = new Straddle(-6, 60, bodyBlue, 0);
const autopilots = [new Autopilot(aiYellow), new Autopilot(aiBlue)];

// ---------- Cameras ----------

const cockpit = new FreeCamera("cockpit", Vector3.Zero(), scene);
cockpit.minZ = 0.1;
cockpit.inputs.clear(); // stop the camera grabbing WASD

const chase = new FreeCamera("chase", Vector3.Zero(), scene);
chase.minZ = 0.1;
chase.inputs.clear();

let activeCam: FreeCamera = cockpit;
scene.activeCamera = cockpit;

// Driver's eye position, just in front of the seated driver's head
const CAB_LOCAL = new Vector3(-2.6, 7.4, 3.9);
const SPREADER_LOOK_LOCAL = new Vector3(0, 5.0, 0);

// Cockpit look direction, in the carrier's frame (yaw 0 = straight ahead,
// positive yaw = right, positive pitch = up). Default points at the spreader.
const spreaderDir = SPREADER_LOOK_LOCAL.subtract(CAB_LOCAL);
const DEFAULT_YAW = Math.atan2(spreaderDir.x, spreaderDir.z);
const DEFAULT_PITCH = Math.atan2(spreaderDir.y, Math.hypot(spreaderDir.x, spreaderDir.z));
let lookYaw = DEFAULT_YAW;
let lookPitch = DEFAULT_PITCH;
const PITCH_MIN = -1.2;
const PITCH_MAX = 0.6;
const LOOK_KEY_RATE = 1.5;
const LOOK_MOUSE_SENS = 0.005;

function recentreLook(): void {
  lookYaw = DEFAULT_YAW;
  lookPitch = DEFAULT_PITCH;
}

function updateCameras(): void {
  const body = player.localToWorld(Vector3.Zero());
  const forward = new Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));

  const eye = player.localToWorld(CAB_LOCAL);
  cockpit.position = eye;
  const localDir = new Vector3(
    Math.sin(lookYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    Math.cos(lookYaw) * Math.cos(lookPitch),
  );
  player.root.computeWorldMatrix(true);
  const worldDir = Vector3.TransformNormal(localDir, player.root.getWorldMatrix()).normalize();
  cockpit.setTarget(eye.add(worldDir.scale(10)));

  chase.position = body.subtract(forward.scale(18)).add(new Vector3(0, 8, 0));
  chase.setTarget(body.add(new Vector3(0, 3, 0)));
}

// ---------- Input ----------

const keysDown = new Set<string>();
let dragging = false;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  keysDown.add(e.code);
  if (e.repeat) return;
  if (e.code === "Digit1") activeCam = cockpit;
  if (e.code === "Digit2") activeCam = chase;
  if (e.code === "KeyV") recentreLook();
  if (e.code === "Space") toggleLock(player);
});
window.addEventListener("keyup", (e) => keysDown.delete(e.code));
window.addEventListener("blur", () => {
  keysDown.clear();
  dragging = false;
});

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => (dragging = false));
canvas.addEventListener("pointercancel", () => (dragging = false));
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  lookYaw += e.movementX * LOOK_MOUSE_SENS;
  lookPitch = clamp(lookPitch - e.movementY * LOOK_MOUSE_SENS, PITCH_MIN, PITCH_MAX);
});

function playerControls(): Controls {
  const k = keysDown;
  return {
    throttle: k.has("KeyW") ? 1 : k.has("KeyS") ? -1 : 0,
    steer: (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0),
    hoist: (k.has("KeyR") ? 1 : 0) - (k.has("KeyF") ? 1 : 0),
    shift: (k.has("KeyI") ? 1 : 0) - (k.has("KeyK") ? 1 : 0),
  };
}

// ---------- Loop ----------

function update(dt: number): void {
  player.step(dt, playerControls());
  for (const ap of autopilots) {
    ap.s.step(dt, ap.step(dt));
  }
  stepContainers(dt);

  if (keysDown.has("ArrowLeft")) lookYaw -= LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowRight")) lookYaw += LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowUp")) lookPitch += LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowDown")) lookPitch -= LOOK_KEY_RATE * dt;
  lookPitch = clamp(lookPitch, PITCH_MIN, PITCH_MAX);

  updateCameras();
  scene.activeCamera = activeCam;

  const stacked = pickables.filter((p) => !p.attached && inStack(p.mesh.position)).length;
  const lockText = player.held
    ? "LOCKED (Space to release)"
    : pickables.some((p) => player.canLock(p))
      ? "lock available (Space)"
      : "open";
  const camName = activeCam === cockpit ? "cockpit" : "chase";
  hud.textContent =
    `${(Math.abs(player.speed) * 3.6).toFixed(1)} km/h  steer ${((player.steer / MAX_STEER) * 100).toFixed(0)}%\n` +
    `spreader ${player.spreaderY.toFixed(1)} m  shift ${player.shiftX.toFixed(1)} m  sway ${Math.hypot(player.swayX, player.swayZ).toFixed(2)} m\n` +
    `twistlocks: ${lockText}\n` +
    `stacked in yard: ${stacked} of ${pickables.length}   (max ${MAX_TIER} high)\n` +
    `camera: ${camName}\n` +
    `W/S throttle+brake   A/D steer   R/F hoist   I/K shift\n` +
    `Space twistlocks   1 cockpit   2 chase\n` +
    `cockpit: drag or arrows to look   V recentre`;
}

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (dt > 0) update(dt);
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
