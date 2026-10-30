import { Engine, FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import {
  CONTAINER_CENTRE_ON_GROUND,
  CRANE_ZS,
  Crane,
  MAX_TIER,
  addPickableOnGround,
  inStack,
  initWorld,
  material,
  pickables,
  stepContainers,
} from "./world";
import { Autopilot, Straddle, toggleLock, type CarrierMats, type Controls } from "./straddle";
import { buildHorizon } from "./horizon";

// ---------- Setup ----------

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
initWorld(scene);
buildHorizon(scene);

// Shared materials for the cab, and body colours for each carrier
const glass = material("glass", 0.55, 0.75, 0.9);
glass.alpha = 0.35;
const hiVis = material("hiVis", 1.0, 0.45, 0.0);
const skin = material("skin", 0.85, 0.7, 0.6);

function carrierMats(name: string, r: number, g: number, b: number): CarrierMats {
  return { body: material(`${name}Body`, r, g, b), glass, hiVis, skin };
}

// ---------- Entities ----------

const player = new Straddle(scene, carrierMats("player", 0.85, 0.2, 0.1), 0, -30, 0);
const aiYellow = new Straddle(scene, carrierMats("yellow", 0.95, 0.75, 0.1), 27, -62, 0);
const aiBlue = new Straddle(scene, carrierMats("blue", 0.15, 0.35, 0.85), 27, 64, 0);

// Each AI carrier works one crane's zone. The middle crane (z 0) is left to the player.
const autopilots: Autopilot[] = [
  new Autopilot(aiYellow, CRANE_ZS[0], -1),
  new Autopilot(aiBlue, CRANE_ZS[2], 1),
];

const cranes = CRANE_ZS.map((z, i) => new Crane(z, i));

// Starting containers on the apron for the player to pick up
addPickableOnGround(new Vector3(0, CONTAINER_CENTRE_ON_GROUND, -22), 1);
addPickableOnGround(new Vector3(26, CONTAINER_CENTRE_ON_GROUND, -8), 3);

// ---------- Cameras ----------

const cockpit = new FreeCamera("cockpit", Vector3.Zero(), scene);
cockpit.minZ = 0.1;
cockpit.inputs.clear(); // stop the camera grabbing WASD

const chase = new FreeCamera("chase", Vector3.Zero(), scene);
chase.minZ = 0.1;
chase.inputs.clear();

// Drone: circles the dock at 1,000 ft above sea level, always looking at the player's carrier
const drone = new FreeCamera("drone", Vector3.Zero(), scene);
drone.minZ = 0.5;
drone.inputs.clear();
const DRONE_CENTRE = new Vector3(20, 0, 0); // middle of the apron and the crane line
const DRONE_RADIUS = 220; // m
const DRONE_ALT = 305; // m, 1,000 ft
const DRONE_RATE = 0.12; // rad/s
let droneAngle = 0;

let activeCam: FreeCamera = cockpit;
scene.activeCamera = cockpit;

// Driver's eye position, just in front of the seated driver's head
const CAB_LOCAL = new Vector3(-2.6, 7.4, 3.9);
const SPREADER_LOOK_LOCAL = new Vector3(0, 5.0, 0);

// Cockpit look direction in the carrier's frame (yaw 0 = straight ahead, positive yaw = right, positive pitch = up)
const spreaderDir = SPREADER_LOOK_LOCAL.subtract(CAB_LOCAL);
const DEFAULT_YAW = Math.atan2(spreaderDir.x, spreaderDir.z);
const DEFAULT_PITCH = Math.atan2(spreaderDir.y, Math.hypot(spreaderDir.x, spreaderDir.z));
let lookYaw = DEFAULT_YAW;
let lookPitch = DEFAULT_PITCH;
const PITCH_MIN = -1.2;
const PITCH_MAX = 0.6;
const LOOK_KEY_RATE = 1.5;
const LOOK_MOUSE_SENS = 0.005;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

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

  drone.position = new Vector3(
    DRONE_CENTRE.x + DRONE_RADIUS * Math.cos(droneAngle),
    DRONE_ALT,
    DRONE_CENTRE.z + DRONE_RADIUS * Math.sin(droneAngle),
  );
  drone.setTarget(body.add(new Vector3(0, 3, 0)));
}

const CAM_NAMES = new Map<FreeCamera, string>([
  [cockpit, "cockpit"],
  [chase, "chase"],
  [drone, "drone"],
]);

// ---------- Input ----------

const keysDown = new Set<string>();
let dragging = false;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  keysDown.add(e.code);
  if (e.repeat) return;
  if (e.code === "Digit1") activeCam = cockpit;
  if (e.code === "Digit2") activeCam = chase;
  if (e.code === "Digit3") activeCam = drone;
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
  for (const c of cranes) c.step(dt);
  stepContainers(dt);

  if (keysDown.has("ArrowLeft")) lookYaw -= LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowRight")) lookYaw += LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowUp")) lookPitch += LOOK_KEY_RATE * dt;
  if (keysDown.has("ArrowDown")) lookPitch -= LOOK_KEY_RATE * dt;
  lookPitch = clamp(lookPitch, PITCH_MIN, PITCH_MAX);
  droneAngle += DRONE_RATE * dt;

  updateCameras();
  scene.activeCamera = activeCam;

  const stacked = pickables.filter((p) => !p.attached && inStack(p.mesh.position)).length;
  const lockText = player.held
    ? "LOCKED (Space to release)"
    : pickables.some((p) => player.canLock(p))
      ? "lock available (Space)"
      : "open";
  const camName = CAM_NAMES.get(activeCam) ?? "";
  hud.textContent =
    `${(Math.abs(player.speed) * 3.6).toFixed(1)} km/h  steer ${((player.steer / 0.55) * 100).toFixed(0)}%\n` +
    `spreader ${player.spreaderY.toFixed(1)} m  shift ${player.shiftX.toFixed(1)} m  sway ${Math.hypot(player.swayX, player.swayZ).toFixed(2)} m\n` +
    `twistlocks: ${lockText}\n` +
    `stacked in yard: ${stacked} of ${pickables.length}   (max ${MAX_TIER} high)\n` +
    `camera: ${camName}\n` +
    `W/S throttle+brake   A/D steer   R/F hoist   I/K shift\n` +
    `Space twistlocks   1 cockpit   2 chase   3 drone\n` +
    `cockpit: drag or arrows to look   V recentre`;
}

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (dt > 0) update(dt);
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
