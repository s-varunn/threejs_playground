import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const MAX_POINTS = 60000;

// Lorenz parameters
const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;
const BASE_DT = 0.003;

const TRAIL_VERT = `
attribute float aAlpha;
attribute float aAttractor;
varying float vAlpha;
varying float vAttractor;
void main() {
  vAlpha = aAlpha;
  vAttractor = aAttractor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAG = `
varying float vAlpha;
varying float vAttractor;
uniform float uTime;

vec3 palette(float t, float id) {
  // 3 distinct neon palettes per attractor
  if (id < 0.5) {
    // cyan-teal
    return mix(vec3(0.0, 0.4, 0.8), vec3(0.0, 1.0, 0.9), t);
  } else if (id < 1.5) {
    // magenta-pink
    return mix(vec3(0.5, 0.0, 0.8), vec3(1.0, 0.1, 0.8), t);
  } else {
    // amber-gold
    return mix(vec3(0.8, 0.2, 0.0), vec3(1.0, 0.8, 0.1), t);
  }
}

void main() {
  vec3 color = palette(vAlpha, vAttractor);
  float glow = pow(vAlpha, 1.5);
  gl_FragColor = vec4(color * (1.0 + glow * 0.8), vAlpha * 0.9);
}
`;

interface LorenzState {
  x: number; y: number; z: number;
  sigma: number; rho: number; beta: number;
}

export class MathEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private disposed = false;
  private canvas: HTMLCanvasElement;
  private speed = 1.0;

  private attractors: LorenzState[] = [
    { x: 0.1,  y: 0,    z: 0,    sigma: 10, rho: 28,   beta: 8/3 },
    { x: -0.1, y: 0.1,  z: 15,   sigma: 10, rho: 28,   beta: 8/3 },
    { x: 0.05, y: -0.1, z: 28,   sigma: 10, rho: 28,   beta: 8/3 },
  ];

  // Per-attractor ring buffers
  private posAttrs: THREE.BufferAttribute[] = [];
  private alphaAttrs: THREE.BufferAttribute[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private lines: THREE.Line[] = [];
  private heads: number[] = [0, 0, 0];
  private counts: number[] = [0, 0, 0];

  private listeners: { el: EventTarget; type: string; fn: any }[] = [];
  private time = 0;
  private particleSize = 1.0;

  // Nebula fog
  private fogMesh: THREE.Mesh | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010108);
    this.scene.fog = new THREE.FogExp2(0x010108, 0.003);

    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 2000);
    this.camera.position.set(30, 20, 80);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.04;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.target.set(0, 0, 25);

    this.buildGeometries();
    this.addGrid();
    this.addNebula();

    this.listen(window, "keydown", (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") this.reset();
      if (e.key === "+" || e.key === "=") this.speed = Math.min(this.speed * 1.5, 8);
      if (e.key === "-") this.speed = Math.max(this.speed / 1.5, 0.1);
    });
  }

  private listen(el: EventTarget, type: string, fn: any) {
    el.addEventListener(type, fn);
    this.listeners.push({ el, type, fn });
  }

  private buildGeometries() {
    const perAttractor = Math.floor(MAX_POINTS / 3);
    for (let a = 0; a < 3; a++) {
      const positions = new Float32Array(perAttractor * 3);
      const alphas = new Float32Array(perAttractor);
      const attractorId = new Float32Array(perAttractor).fill(a);

      const posAttr = new THREE.BufferAttribute(positions, 3);
      const alphaAttr = new THREE.BufferAttribute(alphas, 1);
      const idAttr = new THREE.BufferAttribute(attractorId, 1);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      alphaAttr.setUsage(THREE.DynamicDrawUsage);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", posAttr);
      geo.setAttribute("aAlpha", alphaAttr);
      geo.setAttribute("aAttractor", idAttr);
      geo.setDrawRange(0, 0);

      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geo, mat);
      this.scene.add(line);

      this.posAttrs.push(posAttr);
      this.alphaAttrs.push(alphaAttr);
      this.geometries.push(geo);
      this.lines.push(line);
      this.heads.push(0);
      this.counts.push(0);
    }
  }

  private addGrid() {
    const grid = new THREE.GridHelper(200, 30, 0x0a0a22, 0x0a0a22);
    grid.position.y = -30;
    this.scene.add(grid);
  }

  private addNebula() {
    // Distant glowing cloud sprites
    const count = 12;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80 + 20;
      sizes[i] = 20 + Math.random() * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float aSize;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 200.0 / -mvPos.z;
          gl_Position = projectionMatrix * mvPos;
        }`,
      fragmentShader: `
        void main() {
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          float a = (1.0 - smoothstep(0.1, 0.5, r)) * 0.06;
          gl_FragColor = vec4(0.1, 0.3, 0.8, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  private step(state: LorenzState, dt: number) {
    const { x, y, z, sigma, rho, beta } = state;
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;
    state.x += dx * dt;
    state.y += dy * dt;
    state.z += dz * dt;
  }

  reset() {
    for (let a = 0; a < 3; a++) {
      this.attractors[a].x = (Math.random() - 0.5) * 0.3;
      this.attractors[a].y = (Math.random() - 0.5) * 0.3;
      this.attractors[a].z = Math.random() * 5;
      this.heads[a] = 0;
      this.counts[a] = 0;
      this.posAttrs[a].array.fill(0);
      this.posAttrs[a].needsUpdate = true;
      this.alphaAttrs[a].array.fill(0);
      this.alphaAttrs[a].needsUpdate = true;
      this.geometries[a].setDrawRange(0, 0);
    }
  }

  setSpeed(s: number) { this.speed = s; }

  render(delta: number) {
    if (this.disposed) return;
    this.time += delta;

    const perAttractor = Math.floor(MAX_POINTS / 3);
    const stepsPerFrame = Math.round(12 * this.speed);
    const dt = BASE_DT;

    for (let a = 0; a < 3; a++) {
      const state = this.attractors[a];
      const posAttr = this.posAttrs[a];
      const alphaAttr = this.alphaAttrs[a];
      const geo = this.geometries[a];
      const mat = (this.lines[a].material as THREE.ShaderMaterial);
      mat.uniforms.uTime.value = this.time;

      for (let s = 0; s < stepsPerFrame; s++) {
        this.step(state, dt);
        const idx = this.heads[a] % perAttractor;
        posAttr.setXYZ(idx, state.x, state.y - 25, state.z);
        this.heads[a]++;
        if (this.counts[a] < perAttractor) this.counts[a]++;
      }
      posAttr.needsUpdate = true;

      const totalCount = Math.min(this.counts[a], perAttractor);
      const alphas = alphaAttr.array as Float32Array;
      const startIdx = this.counts[a] >= perAttractor ? this.heads[a] % perAttractor : 0;
      for (let i = 0; i < totalCount; i++) {
        alphas[(startIdx + i) % perAttractor] = i / totalCount;
      }
      alphaAttr.needsUpdate = true;
      geo.setDrawRange(0, totalCount);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.controls.dispose();
    for (const { el, type, fn } of this.listeners) el.removeEventListener(type, fn);
    for (let a = 0; a < 3; a++) {
      this.geometries[a]?.dispose();
      (this.lines[a].material as THREE.Material)?.dispose();
      this.scene.remove(this.lines[a]);
    }
  }
}
