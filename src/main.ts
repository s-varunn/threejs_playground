import * as THREE from "three";
import { PhysicsScene } from "./scenes/PhysicsScene";
import { EmbeddingExplorer } from "./scenes/EmbeddingExplorer";
import { MathEngine } from "./scenes/MathEngine";

export type TabId = "physics" | "embedding" | "lorenz";

let renderer: THREE.WebGLRenderer | null = null;
let physicsScene: PhysicsScene | null = null;
let embeddingScene: EmbeddingExplorer | null = null;
let mathScene: MathEngine | null = null;
let activeTab: TabId = "physics";
let animId: number | null = null;
let lastTime = performance.now();
let elapsed = 0;
let frameCount = 0;
let fpsLastTime = performance.now();
let currentFps = 60;

export function initRenderer(canvas: HTMLCanvasElement) {
  if (renderer) return;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setClearColor(0x020610);
  renderer.autoClear = true;

  window.addEventListener("resize", onResize);
}

function onResize() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  if (embeddingScene) embeddingScene.resize(w, h);
  if (mathScene) mathScene.resize(w, h);
}

export function setActiveTab(tab: TabId) {
  if (!renderer) return;

  if (physicsScene) { physicsScene.dispose(); physicsScene = null; }
  if (embeddingScene) { embeddingScene.dispose(); embeddingScene = null; }
  if (mathScene) { mathScene.dispose(); mathScene = null; }
  if (animId !== null) { cancelAnimationFrame(animId); animId = null; }

  activeTab = tab;
  lastTime = performance.now();
  elapsed = 0;

  if (tab === "physics") {
    physicsScene = new PhysicsScene(renderer);
  } else if (tab === "embedding") {
    embeddingScene = new EmbeddingExplorer(renderer);
    embeddingScene.resize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  } else if (tab === "lorenz") {
    mathScene = new MathEngine(renderer);
    mathScene.resize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  }

  loop();
}

function loop() {
  animId = requestAnimationFrame(loop);
  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  elapsed += delta;

  // FPS measurement
  frameCount++;
  if (now - fpsLastTime >= 500) {
    currentFps = Math.round(frameCount * 1000 / (now - fpsLastTime));
    frameCount = 0;
    fpsLastTime = now;
  }

  if (!renderer) return;

  if (activeTab === "physics" && physicsScene) {
    physicsScene.render(delta);
  } else if (activeTab === "embedding" && embeddingScene) {
    embeddingScene.render(delta, elapsed);
  } else if (activeTab === "lorenz" && mathScene) {
    mathScene.render(delta);
  }
}

export function getFps() { return currentFps; }

export function embeddingMorphTo(shapeIdx: number) {
  embeddingScene?.morphTo(shapeIdx);
}

export function lorenzSetSpeed(s: number) {
  mathScene?.setSpeed(s);
}

export function lorenzReset() {
  mathScene?.reset();
}

export function destroyRenderer() {
  if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
  if (physicsScene) { physicsScene.dispose(); physicsScene = null; }
  if (embeddingScene) { embeddingScene.dispose(); embeddingScene = null; }
  if (mathScene) { mathScene.dispose(); mathScene = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  window.removeEventListener("resize", onResize);
}
