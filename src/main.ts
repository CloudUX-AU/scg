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

// ---------- Yard ----------

const yard = MeshBuilder.CreateGround("yard", { width: 240, height: 240 }, scene);
yard.material = material("asphalt", 0.32, 0.32, 0.34);

// Reference containers for scale (stacking comes in M3)
const containerSpots: [number, number, [number, number, number]][] = [
  [20, -15, [0.1, 0.35, 0.7]],
  [20, -8.5, [0.85, 0.5, 0.1]],
  [26, -15, [0.2, 0.6, 0.3]],
  [-20, 10, [0.7, 0.7, 0.72]],
];
for (const [x, z, [r, g, b]] of containerSpots) {
  const box = MeshBuilder.CreateBox("container", { width: 2.44, height: 2.6, depth: 6.06 }, scene);
  box.position = new Vector3(x, 1.3, z);
  box.material = material("container", r, g, b);
}

// ---------- Straddle carrier (unbranded, simplified) ----------

const carrier = new TransformNode("carrier", scene);
carrier.position = new Vector3(0, 0, -30);

const bodyRed = material("body", 0.85, 0.15, 0.1);
const darkGrey = material("dark", 0.15, 0.15, 0.15);
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

// Chassis
part("chassis", { width: 7, height: 0.6, depth: 11 }, darkGrey, [0, 0.9, 0]);

// Four legs (x = track width, z = wheelbase)
for (const x of [-3.2, 3.2]) {
  for (const z of [-5, 5]) {
    part("leg", { width: 0.7, height: 9.3, depth: 0.7 }, bodyRed, [x, 5.85, z]);
  }
}

// Cross beams at the top, front and rear
for (const z of [-5, 5]) {
  part("beam", { width: 7.2, height: 1.0, depth: 0.8 }, bodyRed, [0, 10.8, z]);
}

// Spreader (static in M1; hoisting comes in M2)
part("spreader", { width: 2.6, height: 0.4, depth: 6.2 }, darkGrey, [0, 4.0, 0]);

// Cab on the front-left leg, facing the machine centreline
part("cab", { width: 1.2, height: 1.6, depth: 1.6 }, bodyRed, [-2.7, 7.0, 4.0]);
part("cabGlass", { width: 1.22, height: 1.0, depth: 1.62 }, cabGlass, [-2.7, 7.2, 4.0]);

// Wheels: one per leg corner
for (const x of [-3.2, 3.2]) {
  for (const z of [-5, 5]) {
    const wheel = MeshBuilder.CreateCylinder(
      "wheel",
      { diameter: 1.3, height: 0.6, tessellation: 16 },
      scene,
    );
    wheel.rotation = new Vector3(0, 0, Math.PI / 2);
    wheel.position = new Vector3(x, 0.65, z);
    wheel.material = tyre;
    wheel.parent = carrier;
  }
}

// ---------- Cameras ----------

const cockpit = new FreeCamera("cockpit", Vector3.Zero(), scene);
cockpit.minZ = 0.1;
cockpit.inputs.clear(); // stop the camera grabbing WASD

const chase = new FreeCamera("chase", Vector3.Zero(), scene);
chase.minZ = 0.1;
chase.inputs.clear();

let activeCam: FreeCamera = cockpit;
let lookForward = false; // V toggles cockpit view between spreader and ahead
scene.activeCamera = cockpit;

const CAB_LOCAL = new Vector3(-2.7, 7.0, 4.0);
const SPREADER_LOCAL = new Vector3(0, 4.0, 0);

function localToWorld(p: Vector3): Vector3 {
  carrier.computeWorldMatrix(true);
  return Vector3.TransformCoordinates(p, carrier.getWorldMatrix());
}

function updateCameras(forward: Vector3): void {
  const body = localToWorld(Vector3.Zero());

  // Cockpit: seated in the cab
  const eye = localToWorld(CAB_LOCAL);
  cockpit.position = eye;
  const target = lookForward
    ? eye.add(forward.scale(30)).add(new Vector3(0, -2, 0))
    : localToWorld(SPREADER_LOCAL);
  cockpit.setTarget(target);

  // Chase: behind and above the machine
  chase.position = body.subtract(forward.scale(18)).add(new Vector3(0, 8, 0));
  chase.setTarget(body.add(new Vector3(0, 3, 0)));
}

// ---------- Input ----------

const keysDown = new Set<string>();

window.addEventListener("keydown", (e) => {
  keysDown.add(e.code);
  if (e.repeat) return;
  if (e.code === "Digit1") activeCam = cockpit;
  if (e.code === "Digit2") activeCam = chase;
  if (e.code === "KeyV") lookForward = !lookForward;
});
window.addEventListener("keyup", (e) => keysDown.delete(e.code));
window.addEventListener("blur", () => keysDown.clear());

// ---------- Driving model (kinematic bicycle model, no physics yet) ----------

const MAX_FWD = 6; // m/s, about 22 km/h
const MAX_REV = 2;
const ACCEL = 2.0;
const DECEL = 3.5;
const MAX_STEER = 0.55; // radians
const STEER_RATE = 1.8; // radians/s, wheel swing speed
const WHEELBASE = 10;
const YARD_LIMIT = 110;

let speed = 0;
let steer = 0;
let heading = 0;

function update(dt: number): void {
  // Throttle and brake
  const throttle = keysDown.has("KeyW") ? 1 : keysDown.has("KeyS") ? -1 : 0;
  const target = throttle > 0 ? MAX_FWD : throttle < 0 ? -MAX_REV : 0;
  const braking = target === 0 || (speed !== 0 && Math.sign(target) !== Math.sign(speed));
  const rate = braking ? DECEL : ACCEL;
  const dv = target - speed;
  speed += Math.max(-rate * dt, Math.min(rate * dt, dv));

  // Steering: wheel swings toward input and returns to centre on release
  const steerInput = (keysDown.has("KeyD") ? 1 : 0) - (keysDown.has("KeyA") ? 1 : 0);
  const ds = steerInput * MAX_STEER - steer;
  steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, ds));

  // Bicycle model: heading changes with speed and steer angle
  heading += ((speed * Math.tan(steer)) / WHEELBASE) * dt;
  carrier.rotation.y = heading;

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  carrier.position.addInPlace(forward.scale(speed * dt));
  carrier.position.x = Math.max(-YARD_LIMIT, Math.min(YARD_LIMIT, carrier.position.x));
  carrier.position.z = Math.max(-YARD_LIMIT, Math.min(YARD_LIMIT, carrier.position.z));

  const forwardNow = forward;
  updateCameras(forwardNow);
  scene.activeCamera = activeCam;

  const camName = activeCam === cockpit ? "cockpit" : "chase";
  const lookName = activeCam === cockpit ? (lookForward ? " (looking ahead)" : " (on spreader)") : "";
  hud.textContent =
    `${(Math.abs(speed) * 3.6).toFixed(1)} km/h  steer ${((steer / MAX_STEER) * 100).toFixed(0)}%\n` +
    `camera: ${camName}${lookName}\n` +
    `W/S throttle+brake   A/D steer\n` +
    `1 cockpit   2 chase   V look ahead`;
}

// ---------- Loop ----------

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  update(dt);
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
