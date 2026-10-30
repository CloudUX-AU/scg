import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
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

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- Constants ----------

const GRAVITY = 9.81;
const CONTAINER = { width: 2.44, height: 2.6, depth: 6.06 };
const CONTAINER_CENTRE_ON_GROUND = CONTAINER.height / 2; // 1.3
const CONTAINER_TOP_ON_GROUND = CONTAINER.height; // 2.6

const APRON_X0 = 20;
const APRON_X1 = 32;
const SHIP_X = 47;
const SHIP_LEN = 150;
const SHIP_DECK = 4;

// ---------- Environment ----------

const yard = MeshBuilder.CreateGround("yard", { width: 140, height: 240 }, scene);
yard.position.x = -50; // spans x -120..20
yard.material = material("asphalt", 0.32, 0.32, 0.34);

const apron = MeshBuilder.CreateBox(
  "apron",
  { width: APRON_X1 - APRON_X0, height: 0.4, depth: 240 },
  scene,
);
apron.position = new Vector3((APRON_X0 + APRON_X1) / 2, -0.2, 0);
apron.material = material("concrete", 0.6, 0.6, 0.6);

const water = MeshBuilder.CreateGround("water", { width: 160, height: 240 }, scene);
water.position = new Vector3(APRON_X1 + 80, -0.6, 0);
water.material = material("water", 0.1, 0.3, 0.45);

function lightMast(x: number, z: number): void {
  const pole = MeshBuilder.CreateCylinder("mast", { diameter: 0.6, height: 30, tessellation: 8 }, scene);
  pole.position = new Vector3(x, 15, z);
  pole.material = material("pole", 0.7, 0.7, 0.72);
  const lamp = MeshBuilder.CreateBox("lamp", { width: 3, height: 0.6, depth: 1.5 }, scene);
  lamp.position = new Vector3(x, 30.2, z);
  lamp.material = material("lampHead", 0.95, 0.95, 0.85);
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

const office = MeshBuilder.CreateBox("office", { width: 16, height: 8, depth: 10 }, scene);
office.position = new Vector3(-95, 4, -70);
office.material = material("office", 0.9, 0.9, 0.88);

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

// Ship: hull, bridge, and two tiers of containers on deck
const ship = MeshBuilder.CreateBox("ship", { width: 24, height: 8, depth: SHIP_LEN }, scene);
ship.position = new Vector3(SHIP_X, 0, 0);
ship.material = material("hull", 0.14, 0.2, 0.3);

const bridge = MeshBuilder.CreateBox("bridge", { width: 12, height: 8, depth: 16 }, scene);
bridge.position = new Vector3(SHIP_X, SHIP_DECK + 4, -62);
bridge.material = material("bridgeWhite", 0.95, 0.95, 0.95);

let shipBoxCount = 0;
for (let col = 0; col < 9; col++) {
  for (let row = 0; row < 12; row++) {
    for (let tier = 0; tier < 2; tier++) {
      const x = 36.5 + col * 2.5;
      const z = -45 + row * CONTAINER.depth;
      const y = SHIP_DECK + CONTAINER.height * (tier + 0.5);
      addContainer(
        `shipBox${shipBoxCount++}`,
        col + row + tier,
        new Vector3(x, y, z),
      );
    }
  }
}

// Yard block: three columns, two high, along the lane
for (const x of [-52.5, -50, -47.5]) {
  for (let row = 0; row < 20; row++) {
    for (let tier = 0; tier < 2; tier++) {
      const z = -60 + row * CONTAINER.depth;
      const y = CONTAINER_CENTRE_ON_GROUND + tier * CONTAINER.height;
      addContainer(`yardBox`, row + tier, new Vector3(x, y, z));
    }
  }
}

// ---------- Cranes ----------

const craneRed = material("craneRed", 0.85, 0.15, 0.1);
const craneYellow = material("craneYellow", 0.95, 0.75, 0.1);
const darkGrey = material("dark", 0.15, 0.15, 0.15);

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

// ---------- Pickable containers (the ones the carrier can lift) ----------

type Pickable = { mesh: Mesh; vy: number; attached: boolean };
const pickables: Pickable[] = [];

function addPickable(pos: Vector3, colour: number, yaw = 0): void {
  const mesh = addContainer(`pickable${pickables.length}`, colour, pos, yaw);
  pickables.push({ mesh, vy: 0, attached: false });
}
addPickable(new Vector3(0, CONTAINER_CENTRE_ON_GROUND, -22), 1);
addPickable(new Vector3(26, CONTAINER_CENTRE_ON_GROUND, -8), 3);

// ---------- Straddle carrier ----------

const carrier = new TransformNode("carrier", scene);
carrier.position = new Vector3(0, 0, -30);

const bodyRed = material("body", 0.85, 0.15, 0.1);
const tyre = material("tyre", 0.08, 0.08, 0.08);
const cabGlass = material("glass", 0.3, 0.45, 0.6);

function part(
  name: string,
  size: { width: number; height: number; depth: number },
  m: StandardMaterial,
  pos: [number, number, number],
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, size, scene);
  mesh.material = m;
  mesh.parent = carrier;
  mesh.position = new Vector3(...pos);
  return mesh;
}

part("chassis", { width: 7, height: 0.6, depth: 11 }, darkGrey, [0, 0.9, 0]);

for (const x of [-3.2, 3.2]) {
  for (const z of [-5, 5]) {
    part("leg", { width: 0.7, height: 9.3, depth: 0.7 }, bodyRed, [x, 5.85, z]);
  }
}

for (const z of [-5, 5]) {
  part("beam", { width: 7.2, height: 1.0, depth: 0.8 }, bodyRed, [0, 10.8, z]);
}

part("cab", { width: 1.2, height: 1.6, depth: 1.6 }, bodyRed, [-2.7, 7.0, 4.0]);
part("cabGlass", { width: 1.22, height: 1.0, depth: 1.62 }, cabGlass, [-2.7, 7.2, 4.0]);

for (const x of [-3.2, 3.2]) {
  for (const z of [-5, 5]) {
    const wheel = MeshBuilder.CreateCylinder("wheel", { diameter: 1.3, height: 0.6, tessellation: 16 }, scene);
    wheel.rotation = new Vector3(0, 0, Math.PI / 2);
    wheel.position = new Vector3(x, 0.65, z);
    wheel.material = tyre;
    wheel.parent = carrier;
  }
}

// ---------- Spreader, ropes, twistlocks ----------

const SPREADER_HALF_H = 0.2;
const SPREADER_MIN_Y = CONTAINER_TOP_ON_GROUND + SPREADER_HALF_H; // bottom rests on a ground container
const SPREADER_MAX_Y = 9.5;
const TROLLEY_Y = 10.4;
const HOIST_RATE = 1.2; // m/s
const SHIFT_RATE = 0.8; // m/s
const SHIFT_MAX = 1.2;
const LOCK_HEIGHT_TOL = 0.3;
const LOCK_X_TOL = 0.3;
const LOCK_Z_TOL = 0.6;
const LOCK_YAW_TOL = 0.06; // rad, about 3.4 degrees
const SWAY_DAMP = 0.6;
const SWAY_MAX = 0.8;

let spreaderY = SPREADER_MAX_Y;
let shiftX = 0;
let swayX = 0;
let swayZ = 0;
let swayVX = 0;
let swayVZ = 0;
let prevSpeed = 0;

const spreaderNode = new TransformNode("spreader", scene);
spreaderNode.parent = carrier;
const spreaderBox = MeshBuilder.CreateBox("spreaderBox", { width: 2.6, height: 0.4, depth: 6.2 }, scene);
spreaderBox.material = darkGrey;
spreaderBox.parent = spreaderNode;

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
const ropes = ROPE_CORNERS.map((_corner, i) => {
  const line = MeshBuilder.CreateLines(
    `rope${i}`,
    { points: [new Vector3(0, TROLLEY_Y, 0), new Vector3(0, 0, 0)] },
    scene,
  );
  line.color = new Color3(0.1, 0.1, 0.1);
  line.parent = carrier;
  return line;
});

function updateRopes(): void {
  const px = shiftX + swayX;
  const pz = swayZ;
  ROPE_CORNERS.forEach(([cx, cz], i) => {
    const [tx, tz] = TROLLEY_CORNERS[i];
    MeshBuilder.CreateLines(
      `rope${i}`,
      {
        points: [
          new Vector3(tx, TROLLEY_Y, tz),
          new Vector3(px + cx, spreaderY + SPREADER_HALF_H, pz + cz),
        ],
        instance: ropes[i],
      },
      scene,
    );
  });
}

// Carrier-frame helpers
function worldToCarrier(p: Vector3): Vector3 {
  carrier.computeWorldMatrix(true);
  return Vector3.TransformCoordinates(p, carrier.getWorldMatrix().clone().invert());
}

let held: Pickable | null = null;

function canLock(p: Pickable): boolean {
  if (p.attached) return false;
  const abs = p.mesh.getAbsolutePosition();
  if (abs.y > CONTAINER_CENTRE_ON_GROUND + 0.05) return false; // only lock onto a container on the ground
  const c = worldToCarrier(abs);
  const yawOff = wrapAngle(p.mesh.rotation.y - carrier.rotation.y);
  return (
    Math.abs(spreaderY - (CONTAINER_TOP_ON_GROUND + SPREADER_HALF_H)) < LOCK_HEIGHT_TOL &&
    Math.abs(c.x - (shiftX + swayX)) < LOCK_X_TOL &&
    Math.abs(c.z - swayZ) < LOCK_Z_TOL &&
    Math.abs(yawOff) < LOCK_YAW_TOL
  );
}

function attach(p: Pickable): void {
  held = p;
  p.attached = true;
  p.vy = 0;
  p.mesh.parent = spreaderNode;
  // Container top sits at the spreader's bottom face, so its centre is half a container below that
  p.mesh.position = new Vector3(0, -(SPREADER_HALF_H + CONTAINER.height / 2), 0);
  p.mesh.rotation = Vector3.Zero();
}

function release(p: Pickable): void {
  const abs = p.mesh.getAbsolutePosition().clone();
  p.mesh.parent = null;
  p.mesh.position = abs;
  p.mesh.rotation = new Vector3(0, carrier.rotation.y, 0);
  p.attached = false;
  held = null;
}

function toggleTwistlocks(): void {
  if (held) {
    release(held);
    return;
  }
  const p = pickables.find(canLock);
  if (p) attach(p);
}

// ---------- Cameras ----------

const cockpit = new FreeCamera("cockpit", Vector3.Zero(), scene);
cockpit.minZ = 0.1;
cockpit.inputs.clear(); // stop the camera grabbing WASD

const chase = new FreeCamera("chase", Vector3.Zero(), scene);
chase.minZ = 0.1;
chase.inputs.clear();

let activeCam: FreeCamera = cockpit;
scene.activeCamera = cockpit;

const CAB_LOCAL = new Vector3(-2.7, 7.0, 4.0);
const SPREADER_LOOK_LOCAL = new Vector3(0, 5.0, 0); // where the cockpit looks by default

function localToWorld(p: Vector3): Vector3 {
  carrier.computeWorldMatrix(true);
  return Vector3.TransformCoordinates(p, carrier.getWorldMatrix());
}

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

function updateCameras(forward: Vector3): void {
  const body = localToWorld(Vector3.Zero());

  const eye = localToWorld(CAB_LOCAL);
  cockpit.position = eye;
  const localDir = new Vector3(
    Math.sin(lookYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    Math.cos(lookYaw) * Math.cos(lookPitch),
  );
  carrier.computeWorldMatrix(true);
  const worldDir = Vector3.TransformNormal(localDir, carrier.getWorldMatrix()).normalize();
  cockpit.setTarget(eye.add(worldDir.scale(10)));

  chase.position = body.subtract(forward.scale(18)).add(new Vector3(0, 8, 0));
  chase.setTarget(body.add(new Vector3(0, 3, 0)));
}

// ---------- Input ----------

const keysDown = new Set<string>();

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  keysDown.add(e.code);
  if (e.repeat) return;
  if (e.code === "Digit1") activeCam = cockpit;
  if (e.code === "Digit2") activeCam = chase;
  if (e.code === "KeyV") recentreLook();
  if (e.code === "Space") toggleTwistlocks();
});
window.addEventListener("keyup", (e) => keysDown.delete(e.code));
window.addEventListener("blur", () => {
  keysDown.clear();
  dragging = false;
});

let dragging = false;
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

// ---------- Driving model (kinematic bicycle model, no physics engine) ----------

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

let speed = 0;
let steer = 0;
let heading = 0;

function update(dt: number): void {
  // Throttle and brake
  const throttle = keysDown.has("KeyW") ? 1 : keysDown.has("KeyS") ? -1 : 0;
  const target = throttle > 0 ? MAX_FWD : throttle < 0 ? -MAX_REV : 0;
  const braking = target === 0 || (speed !== 0 && Math.sign(target) !== Math.sign(speed));
  const rate = braking ? DECEL : ACCEL;
  prevSpeed = speed;
  speed += clamp(target - speed, -rate * dt, rate * dt);
  const longAccel = (speed - prevSpeed) / dt;

  // Steering
  const steerInput = (keysDown.has("KeyD") ? 1 : 0) - (keysDown.has("KeyA") ? 1 : 0);
  steer += clamp(steerInput * MAX_STEER - steer, -STEER_RATE * dt, STEER_RATE * dt);

  // Bicycle model
  heading += ((speed * Math.tan(steer)) / WHEELBASE) * dt;
  carrier.rotation.y = heading;
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  carrier.position.addInPlace(forward.scale(speed * dt));
  carrier.position.x = clamp(carrier.position.x, CARRIER_X_MIN, CARRIER_X_MAX);
  carrier.position.z = clamp(carrier.position.z, -CARRIER_Z_LIMIT, CARRIER_Z_LIMIT);

  // Hoist and side shift
  if (keysDown.has("KeyR")) spreaderY += HOIST_RATE * dt;
  if (keysDown.has("KeyF")) spreaderY -= HOIST_RATE * dt;
  spreaderY = clamp(spreaderY, SPREADER_MIN_Y, SPREADER_MAX_Y);
  if (keysDown.has("KeyI")) shiftX += SHIFT_RATE * dt;
  if (keysDown.has("KeyK")) shiftX -= SHIFT_RATE * dt;
  shiftX = clamp(shiftX, -SHIFT_MAX, SHIFT_MAX);

  // Sway: damped pendulum on the rope, driven by carrier acceleration
  const latAccel = (speed * speed * Math.tan(steer)) / WHEELBASE;
  const ropeLen = Math.max(1, TROLLEY_Y - spreaderY);
  const w2 = GRAVITY / ropeLen;
  swayVX += (-w2 * swayX - SWAY_DAMP * swayVX - latAccel) * dt;
  swayX = clamp(swayX + swayVX * dt, -SWAY_MAX, SWAY_MAX);
  swayVZ += (-w2 * swayZ - SWAY_DAMP * swayVZ - longAccel) * dt;
  swayZ = clamp(swayZ + swayVZ * dt, -SWAY_MAX, SWAY_MAX);

  spreaderNode.position = new Vector3(shiftX + swayX, spreaderY, swayZ);
  updateRopes();

  // Containers not held fall under gravity until they reach the ground
  for (const p of pickables) {
    if (p.attached) continue;
    const pos = p.mesh.position;
    if (pos.y > CONTAINER_CENTRE_ON_GROUND) {
      p.vy -= GRAVITY * dt;
      pos.y += p.vy * dt;
      if (pos.y <= CONTAINER_CENTRE_ON_GROUND) {
        pos.y = CONTAINER_CENTRE_ON_GROUND;
        p.vy = 0;
      }
    }
  }

  updateCameras(forward);
  scene.activeCamera = activeCam;

  // Look-around keys
  if (keysDown.has("ArrowLeft")) lookYaw -= LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowRight")) lookYaw += LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowUp")) lookPitch += LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowDown")) lookPitch -= LOOK_KEY_RATE * dt;
  lookPitch = clamp(lookPitch, PITCH_MIN, PITCH_MAX);

  const lockText = held
    ? "LOCKED (Space to release)"
    : pickables.some(canLock)
      ? "lock available (Space)"
      : "open";
  const camName = activeCam === cockpit ? "cockpit" : "chase";
  hud.textContent =
    `${(Math.abs(speed) * 3.6).toFixed(1)} km/h  steer ${((steer / MAX_STEER) * 100).toFixed(0)}%\n` +
    `spreader ${spreaderY.toFixed(1)} m  shift ${shiftX.toFixed(1)} m  sway ${Math.hypot(swayX, swayZ).toFixed(2)} m\n` +
    `twistlocks: ${lockText}\n` +
    `camera: ${camName}\n` +
    `W/S throttle+brake   A/D steer   R/F hoist   I/K shift\n` +
    `Space twistlocks   1 cockpit   2 chase\n` +
    `cockpit: drag or arrows to look   V recentre`;
}

// ---------- Loop ----------

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (dt > 0) update(dt);
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
