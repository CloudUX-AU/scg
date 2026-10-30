import { Color3, Color4, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

// Sky, haze and distant port scenery. Linear fog fades everything into the horizon colour.

const HAZE = new Color3(0.7, 0.8, 0.88);
const LAND = new Color3(0.34, 0.4, 0.3);
const SEA = new Color3(0.1, 0.27, 0.42);

// Deterministic random so the skyline is the same on every load
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function mat(scene: Scene, name: string, c: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = c;
  m.specularColor = Color3.Black();
  return m;
}

function solid(scene: Scene, name: string, size: { width: number; height: number; depth: number }, m: StandardMaterial, pos: [number, number, number]): Mesh {
  const mesh = MeshBuilder.CreateBox(name, size, scene);
  mesh.material = m;
  mesh.position = new Vector3(...pos);
  return mesh;
}

export function setupFog(scene: Scene): void {
  scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = HAZE;
  scene.fogStart = 250;
  scene.fogEnd = 1500;
}

// Far land to the west and sea to the east, large enough that the fog hides the edges
function buildFarGround(scene: Scene): void {
  const land = MeshBuilder.CreateGround("farLand", { width: 3000, height: 3000 }, scene);
  land.position = new Vector3(-1500, -0.3, 0);
  land.material = mat(scene, "farLandMat", LAND);

  const sea = MeshBuilder.CreateGround("farSea", { width: 3000, height: 3000 }, scene);
  sea.position = new Vector3(1500, -0.7, 0);
  sea.material = mat(scene, "farSeaMat", SEA);
}

// Skyline of towers and warehouses behind the yard
function buildSkyline(scene: Scene): void {
  const rand = seeded(20261030);
  const mats = [mat(scene, "city0", new Color3(0.55, 0.58, 0.62)), mat(scene, "city1", new Color3(0.7, 0.72, 0.74)), mat(scene, "city2", new Color3(0.42, 0.46, 0.52))];
  for (let z = -900; z <= 900; z += 18) {
    const h = 25 + rand() * 90;
    const w = 16 + rand() * 18;
    const d = 14 + rand() * 14;
    const x = -640 - rand() * 120;
    solid(scene, "tower", { width: w, height: h, depth: d }, mats[Math.floor(rand() * mats.length)], [x, h / 2, z]);
  }
  // A few rounded hills behind the city
  const hillMat = mat(scene, "hill", new Color3(0.3, 0.4, 0.3));
  for (let i = 0; i < 6; i++) {
    const hill = MeshBuilder.CreateSphere("hill", { diameter: 2, segments: 12 }, scene);
    hill.scaling = new Vector3(260, 70 + rand() * 60, 240);
    hill.position = new Vector3(-1100 - rand() * 300, 0, -700 + i * 280);
    hill.material = hillMat;
  }
}

// Distant ships across the bay, and a far quay with cranes
function buildBay(scene: Scene): void {
  const rand = seeded(7);
  const hull = mat(scene, "farHull", new Color3(0.12, 0.16, 0.22));
  const white = mat(scene, "farWhite", new Color3(0.9, 0.9, 0.9));
  const red = mat(scene, "farRed", new Color3(0.7, 0.12, 0.1));
  for (let i = 0; i < 7; i++) {
    const x = 520 + rand() * 400;
    const z = -600 + rand() * 1200;
    const len = 130 + rand() * 80;
    solid(scene, "farHullBox", { width: 30, height: 12, depth: len }, hull, [x, 4, z]);
    solid(scene, "farDeck", { width: 26, height: 3, depth: len * 0.7 }, white, [x, 13, z]);
    solid(scene, "farBridge", { width: 16, height: 9, depth: 14 }, white, [x, 19, z - len * 0.2]);
    const funnel = MeshBuilder.CreateCylinder("farFunnel", { diameter: 7, height: 10, tessellation: 10 }, scene);
    funnel.position = new Vector3(x, 22, z + len * 0.15);
    funnel.material = red;
  }

  const quay = mat(scene, "farQuay", new Color3(0.5, 0.5, 0.5));
  const craneMat = mat(scene, "farCrane", new Color3(0.8, 0.3, 0.12));
  solid(scene, "farQuayDeck", { width: 60, height: 3, depth: 900 }, quay, [480, 1.5, 0]);
  for (let z = -420; z <= 420; z += 70) {
    solid(scene, "farLegA", { width: 3, height: 50, depth: 3 }, craneMat, [470, 25, z - 4]);
    solid(scene, "farLegB", { width: 3, height: 50, depth: 3 }, craneMat, [490, 25, z - 4]);
    solid(scene, "farBoom", { width: 46, height: 3, depth: 3 }, craneMat, [495, 52, z - 4]);
  }
}

export function buildHorizon(scene: Scene): void {
  setupFog(scene);
  buildFarGround(scene);
  buildSkyline(scene);
  buildBay(scene);
}
