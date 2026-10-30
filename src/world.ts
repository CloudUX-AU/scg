import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { OBB } from "./collision";
import earcut from "earcut";

// ---------- Shared constants ----------

export const GRAVITY = 9.81;
export const CONTAINER = { width: 2.44, height: 2.6, depth: 6.06 };
export const CONTAINER_CENTRE_ON_GROUND = CONTAINER.height / 2; // 1.3
export const SPREADER_HALF_H = 0.2;

export const SHIP_X = 47;
export const SHIP_DECK = 4;
export const APRON_X0 = 20;
export const APRON_X1 = 34;
export const DROP_X = 27; // crane drop line on the apron
export const CRANE_ZS = [-40, 0, 40];
export const TRAVEL_Y = 20; // crane spreader height while travelling
export const CRANE_RATE = 4; // m/s, trolley and hoist

export const STACK_COL_X = [-60, -51, -42, -33, -24, -15];
export const STACK_ROWS = 8;
export const STACK_Z0 = -48;
export const GATE_Z = STACK_Z0 - 8; // lane entry north of the stack grid
export const MAX_TIER = 3;

// ---------- Scene and materials ----------

let activeScene: Scene | null = null;

function sc(): Scene {
  if (!activeScene) throw new Error("world not initialised");
  return activeScene;
}

export function material(name: string, r: number, g: number, b: number): StandardMaterial {
  const m = new StandardMaterial(name, sc());
  m.diffuseColor = new Color3(r, g, b);
  return m;
}

export function box(
  name: string,
  size: { width: number; height: number; depth: number },
  m: StandardMaterial,
  pos: [number, number, number],
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, size, sc());
  mesh.material = m;
  mesh.position = new Vector3(...pos);
  return mesh;
}

// Materials are created in initWorld, once the scene exists
export let darkGrey: StandardMaterial;
let craneRed: StandardMaterial;
let craneYellow: StandardMaterial;
let hullMat: StandardMaterial;
let hullStripe: StandardMaterial;
let shipWhite: StandardMaterial;
let funnelRed: StandardMaterial;
let funnelBlack: StandardMaterial;
let deckGrey: StandardMaterial;
let containerMats: StandardMaterial[] = [];

// Sets up lights, materials and the whole yard, ship and cranes
export function initWorld(scene: Scene): void {
  activeScene = scene;
  scene.clearColor = new Color4(0.62, 0.74, 0.86, 1);
  new HemisphericLight("sky", new Vector3(0, 1, 0), scene).intensity = 0.75;
  new DirectionalLight("sun", new Vector3(-0.4, -1, 0.3), scene).intensity = 0.6;

  darkGrey = material("dark", 0.15, 0.15, 0.15);
  craneRed = material("craneRed", 0.85, 0.15, 0.1);
  craneYellow = material("craneYellow", 0.95, 0.75, 0.1);
  hullMat = material("hull", 0.14, 0.2, 0.3);
  hullStripe = material("hullStripe", 0.7, 0.1, 0.1);
  shipWhite = material("shipWhite", 0.95, 0.95, 0.95);
  funnelRed = material("funnelRed", 0.8, 0.12, 0.1);
  funnelBlack = material("funnelBlack", 0.08, 0.08, 0.08);
  deckGrey = material("deckGrey", 0.5, 0.5, 0.5);
  containerMats = CONTAINER_COLOURS.map(([r, g, b], i) => material(`containerMat${i}`, r, g, b));

  buildEnvironment();
  buildYardBlock();
  buildShip();
}

// ---------- Static obstacles (solid to carriers) ----------

export const staticObs: OBB[] = [];

function addStaticObs(x: number, z: number, hx: number, hz: number): void {
  staticObs.push({ x, z, hx, hz, yaw: 0 });
}

// ---------- Environment ----------

export function buildEnvironment(): void {
  const s = sc();
  const yard = MeshBuilder.CreateGround("yard", { width: 140, height: 240 }, s);
  yard.position.x = -50; // spans x -120..20
  yard.material = material("asphalt", 0.32, 0.32, 0.34);

  const apron = MeshBuilder.CreateBox("apron", { width: APRON_X1 - APRON_X0, height: 0.4, depth: 240 }, s);
  apron.position = new Vector3((APRON_X0 + APRON_X1) / 2, -0.2, 0);
  apron.material = material("concrete", 0.6, 0.6, 0.6);

  const water = MeshBuilder.CreateGround("water", { width: 160, height: 240 }, s);
  water.position = new Vector3(APRON_X1 + 80, -0.6, 0);
  water.material = material("water", 0.1, 0.3, 0.45);

  // Stack grid markers
  const slotMat = material("slotMark", 0.45, 0.45, 0.42);
  for (const x of STACK_COL_X) {
    for (let row = 0; row < STACK_ROWS; row++) {
      const z = STACK_Z0 + row * CONTAINER.depth;
      box("slotMark", { width: 2.4, height: 0.02, depth: CONTAINER.depth - 0.2 }, slotMat, [x, 0.01, z]);
    }
  }

  // Light masts
  const masts: [number, number][] = [
    [-110, -100],
    [-110, 100],
    [14, -100],
    [14, 100],
    [-60, -110],
    [-60, 110],
  ];
  for (const [x, z] of masts) {
    const pole = MeshBuilder.CreateCylinder("mast", { diameter: 0.6, height: 30, tessellation: 8 }, s);
    pole.position = new Vector3(x, 15, z);
    pole.material = material("pole", 0.7, 0.7, 0.72);
    box("lamp", { width: 3, height: 0.6, depth: 1.5 }, material("lampHead", 0.95, 0.95, 0.85), [x, 30.2, z]);
    addStaticObs(x, z, 0.3, 0.3);
  }

  // Office
  box("office", { width: 16, height: 8, depth: 10 }, material("office", 0.9, 0.9, 0.88), [-95, 4, -70]);
  addStaticObs(-95, -70, 8, 5);
}

// ---------- Containers ----------

const CONTAINER_COLOURS: [number, number, number][] = [
  [0.1, 0.35, 0.7],
  [0.85, 0.5, 0.1],
  [0.2, 0.6, 0.3],
  [0.7, 0.7, 0.72],
  [0.75, 0.15, 0.1],
];
export function addContainer(name: string, colour: number, pos: Vector3, yaw = 0): Mesh {
  const c = MeshBuilder.CreateBox(name, CONTAINER, sc());
  c.material = containerMats[colour % containerMats.length];
  c.position = pos;
  c.rotation.y = yaw;
  return c;
}

// Yard block, a decorative stack away from the working lanes
function buildYardBlock(): void {
  for (const x of [-104, -101.5, -99]) {
    for (let row = 0; row < 20; row++) {
      for (let tier = 0; tier < 2; tier++) {
        const z = -60 + row * CONTAINER.depth;
        const y = CONTAINER_CENTRE_ON_GROUND + tier * CONTAINER.height;
        addContainer("yardBox", row + tier, new Vector3(x, y, z));
        addStaticObs(x, z, CONTAINER.width / 2, CONTAINER.depth / 2);
      }
    }
  }
}

// ---------- Pickable containers ----------

export type Pickable = {
  mesh: Mesh;
  vy: number;
  attached: boolean;
  claimedBy: object | null;
};
export const pickables: Pickable[] = [];

// ---------- Ship ----------

export type DeckStack = { x: number; z: number; meshes: Mesh[]; crane: number };
export const deck: DeckStack[] = [];

function nearestCraneIndex(z: number): number {
  let best = 0;
  for (let i = 1; i < CRANE_ZS.length; i++) {
    if (Math.abs(z - CRANE_ZS[i]) < Math.abs(z - CRANE_ZS[best])) best = i;
  }
  return best;
}

export function buildShip(): void {
  const s = sc();
  const hullOutline = [
    new Vector3(SHIP_X - 12, 0, -75),
    new Vector3(SHIP_X + 12, 0, -75),
    new Vector3(SHIP_X + 12, 0, 45),
    new Vector3(SHIP_X, 0, 75),
    new Vector3(SHIP_X - 12, 0, 45),
  ];
  const hull = MeshBuilder.ExtrudePolygon("hull", { shape: hullOutline, depth: 8, sideOrientation: Mesh.DOUBLESIDE }, s, earcut);
  hull.position.y = -4;
  hull.material = hullMat;

  box("stripeL", { width: 0.2, height: 1.2, depth: 120 }, hullStripe, [SHIP_X - 12.05, -2.4, 0]);
  box("stripeR", { width: 0.2, height: 1.2, depth: 120 }, hullStripe, [SHIP_X + 12.05, -2.4, 0]);
  box("deck", { width: 23, height: 0.1, depth: 148 }, deckGrey, [SHIP_X, SHIP_DECK + 0.05, 0]);

  box("accom", { width: 12, height: 8, depth: 16 }, shipWhite, [SHIP_X, SHIP_DECK + 4, -66]);
  box("accomTop", { width: 10, height: 1, depth: 12 }, shipWhite, [SHIP_X, SHIP_DECK + 8.5, -66]);
  box("bridgeWindows", { width: 9, height: 0.8, depth: 12.1 }, material("windows", 0.15, 0.25, 0.35), [SHIP_X, SHIP_DECK + 7.5, -66]);

  const funnel = MeshBuilder.CreateCylinder("funnel", { diameter: 3.2, height: 5, tessellation: 14 }, s);
  funnel.position = new Vector3(SHIP_X, SHIP_DECK + 13, -66);
  funnel.material = funnelRed;
  const funnelCap = MeshBuilder.CreateCylinder("funnelCap", { diameter: 3.3, height: 0.8, tessellation: 14 }, s);
  funnelCap.position = new Vector3(SHIP_X, SHIP_DECK + 15.4, -66);
  funnelCap.material = funnelBlack;

  const mast = MeshBuilder.CreateCylinder("shipMast", { diameter: 0.3, height: 10, tessellation: 6 }, s);
  mast.position = new Vector3(SHIP_X, SHIP_DECK + 15, -58);
  mast.material = shipWhite;
  box("crossTree", { width: 4, height: 0.2, depth: 0.2 }, shipWhite, [SHIP_X, SHIP_DECK + 13, -58]);

  // Deck stacks, two high, nine columns, fourteen rows
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 14; row++) {
      const x = SHIP_X - 10 + col * 2.5;
      const z = -50 + row * CONTAINER.depth;
      const meshes = [0, 1].map((tier) =>
        addContainer(
          `deckBox${col}_${row}_${tier}`,
          col + row + tier,
          new Vector3(x, SHIP_DECK + CONTAINER.height * (tier + 0.5), z),
        ),
      );
      deck.push({ x, z, meshes, crane: nearestCraneIndex(z) });
    }
  }
}

export function shipBoxesLeft(): number {
  return deck.reduce((n, st) => n + st.meshes.length, 0);
}

export function nextDeckStack(craneIndex: number, fromX: number): DeckStack | null {
  let best: DeckStack | null = null;
  for (const st of deck) {
    if (st.crane !== craneIndex || st.meshes.length === 0) continue;
    if (!best || Math.abs(st.x - fromX) < Math.abs(best.x - fromX)) best = st;
  }
  return best;
}

// ---------- Ship-to-shore cranes ----------

function buildCraneFrame(z: number): void {
  for (const x of [21.5, 32.5]) {
    for (const dz of [-1.5, 1.5]) {
      box("craneLeg", { width: 1.2, height: 42, depth: 1.2 }, craneRed, [x, 21, z + dz]);
      addStaticObs(x, z + dz, 0.6, 0.6);
    }
  }
  box("craneTop", { width: 11, height: 1.6, depth: 3.4 }, craneRed, [27, 42, z]);
  box("boom", { width: 42, height: 1.6, depth: 1.6 }, craneYellow, [42.5, 43, z]);
}

export type CranePhase = "toPick" | "lowerPick" | "liftPick" | "travel" | "lowerDrop" | "returning";

function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
}

export class Crane {
  trolleyX = 47;
  hoistY = TRAVEL_Y;
  phase: CranePhase = "toPick";
  held: Pickable | null = null;
  private stack: DeckStack | null = null;
  private readonly trolley: Mesh;
  private readonly spreader: Mesh;

  constructor(readonly z: number, readonly index: number) {
    buildCraneFrame(z);
    this.trolley = box("trolley", { width: 2.4, height: 1.2, depth: 2.4 }, darkGrey, [47, 44.6, z]);
    this.spreader = box("craneSpreader", { width: 2.6, height: 0.4, depth: 6.2 }, darkGrey, [47, TRAVEL_Y, z]);
  }

  private pileCount(): number {
    return pickables.filter(
      (p) => !p.attached && Math.abs(p.mesh.position.x - DROP_X) < 1 && Math.abs(p.mesh.position.z - this.z) < 2.5,
    ).length;
  }

  step(dt: number): void {
    switch (this.phase) {
      case "toPick": {
        if (!this.stack || this.stack.meshes.length === 0) {
          this.stack = nextDeckStack(this.index, this.trolleyX);
        }
        if (!this.stack) break; // ship unloaded
        this.trolleyX = approach(this.trolleyX, this.stack.x, CRANE_RATE, dt);
        this.hoistY = approach(this.hoistY, TRAVEL_Y, CRANE_RATE, dt);
        if (Math.abs(this.trolleyX - this.stack.x) < 0.05 && Math.abs(this.hoistY - TRAVEL_Y) < 0.05) {
          this.phase = "lowerPick";
        }
        break;
      }
      case "lowerPick": {
        const st = this.stack;
        if (!st || st.meshes.length === 0) {
          this.stack = null;
          this.phase = "toPick";
          break;
        }
        const top = st.meshes[st.meshes.length - 1];
        const want = top.position.y + CONTAINER_CENTRE_ON_GROUND + SPREADER_HALF_H;
        this.hoistY = approach(this.hoistY, want, CRANE_RATE, dt);
        if (this.hoistY <= want + 0.02) {
          st.meshes.pop();
          top.parent = null;
          const entry: Pickable = { mesh: top, vy: 0, attached: true, claimedBy: null };
          pickables.push(entry);
          this.held = entry;
          this.phase = "liftPick";
        }
        break;
      }
      case "liftPick": {
        this.hoistY = approach(this.hoistY, TRAVEL_Y, CRANE_RATE, dt);
        if (this.hoistY >= TRAVEL_Y - 0.05) this.phase = "travel";
        break;
      }
      case "travel": {
        this.trolleyX = approach(this.trolleyX, DROP_X, CRANE_RATE, dt);
        if (Math.abs(this.trolleyX - DROP_X) < 0.05 && this.pileCount() < MAX_TIER) {
          this.phase = "lowerDrop";
        }
        break;
      }
      case "lowerDrop": {
        const p = this.held;
        if (!p) {
          this.phase = "returning";
          break;
        }
        const want = surfaceUnder(DROP_X, this.z, p) + SPREADER_HALF_H + CONTAINER.height;
        this.hoistY = approach(this.hoistY, want, CRANE_RATE, dt);
        if (this.hoistY <= want + 0.02) {
          p.attached = false;
          p.vy = 0;
          p.mesh.position = new Vector3(DROP_X, this.hoistY - SPREADER_HALF_H - CONTAINER_CENTRE_ON_GROUND, this.z);
          p.mesh.rotation = Vector3.Zero();
          this.held = null;
          this.phase = "returning";
        }
        break;
      }
      case "returning": {
        this.hoistY = approach(this.hoistY, TRAVEL_Y, CRANE_RATE, dt);
        if (this.hoistY >= TRAVEL_Y - 0.05) this.phase = "toPick";
        break;
      }
    }

    this.trolley.position.x = this.trolleyX;
    this.spreader.position = new Vector3(this.trolleyX, this.hoistY, this.z);
    if (this.held) {
      this.held.mesh.position = new Vector3(
        this.trolleyX,
        this.hoistY - SPREADER_HALF_H - CONTAINER_CENTRE_ON_GROUND,
        this.z,
      );
    }
  }
}

// ---------- Container queries and physics ----------

// Top of the highest container below `belowY` (default: any height) under this footprint.
// Only containers below count, so a container never lands on one that is stacked above it.
export function surfaceUnder(x: number, z: number, exclude: Pickable | null, belowY = Infinity): number {
  let top = 0;
  for (const o of pickables) {
    if (o === exclude || o.attached) continue;
    const op = o.mesh.position;
    if (op.y >= belowY - 0.01) continue;
    if (Math.abs(op.x - x) < CONTAINER.width / 2 && Math.abs(op.z - z) < CONTAINER.depth / 2) {
      top = Math.max(top, op.y + CONTAINER_CENTRE_ON_GROUND);
    }
  }
  return top;
}

export function isTop(p: Pickable): boolean {
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

export const slots: { x: number; z: number }[] = [];
for (const x of STACK_COL_X) {
  for (let row = 0; row < STACK_ROWS; row++) {
    slots.push({ x, z: STACK_Z0 + row * CONTAINER.depth });
  }
}
export const reservedSlots = new Set<number>();

export function occupancy(slot: { x: number; z: number }, exclude: Pickable | null): number {
  return pickables.filter(
    (p) =>
      p !== exclude &&
      !p.attached &&
      Math.abs(p.mesh.position.x - slot.x) < 1.0 &&
      Math.abs(p.mesh.position.z - slot.z) < 2.5,
  ).length;
}

function slotNear(x: number, z: number, exclude: Pickable): { x: number; z: number } | null {
  for (const s of slots) {
    if (Math.abs(x - s.x) < 1.0 && Math.abs(z - s.z) < 2.5 && occupancy(s, exclude) < MAX_TIER) {
      return s;
    }
  }
  return null;
}

export function inStack(pos: Vector3): boolean {
  const lastX = STACK_COL_X[STACK_COL_X.length - 1];
  return (
    pos.x > STACK_COL_X[0] - CONTAINER.width / 2 &&
    pos.x < lastX + CONTAINER.width / 2 &&
    pos.z > STACK_Z0 - CONTAINER.depth / 2 &&
    pos.z < STACK_Z0 + (STACK_ROWS - 1) * CONTAINER.depth + CONTAINER.depth / 2
  );
}

export function nearestFreeSlot(from: Vector3): number {
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

// Containers not held fall under gravity and settle on whatever is below, snapping into a grid slot when they land in one
export function stepContainers(dt: number): void {
  for (const p of pickables) {
    if (p.attached) continue;
    const m = p.mesh;
    p.vy -= GRAVITY * dt;
    m.position.y += p.vy * dt;
    const surf = surfaceUnder(m.position.x, m.position.z, p, m.position.y);
    if (m.position.y - CONTAINER_CENTRE_ON_GROUND <= surf) {
      const slot = slotNear(m.position.x, m.position.z, p);
      if (slot) {
        m.position.x = slot.x;
        m.position.z = slot.z;
        m.rotation.y = 0;
      }
      const landed = surfaceUnder(m.position.x, m.position.z, p, m.position.y);
      m.position.y = landed + CONTAINER_CENTRE_ON_GROUND;
      p.vy = 0;
    }
  }
}

export function addPickableOnGround(pos: Vector3, colour: number): Pickable {
  const mesh = addContainer(`pickable${pickables.length}`, colour, pos);
  const p: Pickable = { mesh, vy: 0, attached: false, claimedBy: null };
  pickables.push(p);
  return p;
}

// Lazily gathered list of containers that act as obstacles for carriers
export function pickableObstacles(): OBB[] {
  const out: OBB[] = [];
  for (const p of pickables) {
    if (p.attached) continue;
    out.push({
      x: p.mesh.position.x,
      z: p.mesh.position.z,
      hx: CONTAINER.width / 2,
      hz: CONTAINER.depth / 2,
      yaw: p.mesh.rotation.y,
    });
  }
  return out;
}
