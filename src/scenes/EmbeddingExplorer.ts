import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const POINT_COUNT = 12000;

// 4 morph shapes: sphere, grid, helix, galaxy
export type MorphShape = "sphere" | "grid" | "helix" | "galaxy";

const VERT_SHADER = `
attribute vec3 aPos0;  // sphere
attribute vec3 aPos1;  // grid
attribute vec3 aPos2;  // helix
attribute vec3 aPos3;  // galaxy
attribute float aIndex;
attribute vec3 aColor0;

uniform float uT01;   // 0-1 blend between shape 0 and 1
uniform float uShapeA; // integer 0-3
uniform float uShapeB; // integer 0-3
uniform float uTime;
uniform float uHover;
uniform vec3  uHoverPos;

varying vec3 vColor;
varying float vAlpha;

vec3 getPos(float shape) {
  if (shape < 0.5) return aPos0;
  if (shape < 1.5) return aPos1;
  if (shape < 2.5) return aPos2;
  return aPos3;
}

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c / 2.0;
  vec3 rgb;
  if (h < 1.0/6.0)      rgb = vec3(c, x, 0.0);
  else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
  else                   rgb = vec3(c, 0.0, x);
  return rgb + m;
}

void main() {
  vec3 posA = getPos(uShapeA);
  vec3 posB = getPos(uShapeB);
  vec3 pos = mix(posA, posB, uT01);

  // breathing pulse
  float pulse = 1.0 + 0.03 * sin(uTime * 1.2 + aIndex * 0.005);
  pos *= pulse;

  // hover attraction
  if (uHover > 0.0) {
    vec3 diff = uHoverPos - pos;
    float dist = length(diff);
    if (dist < 3.0) {
      pos += normalize(diff) * (3.0 - dist) * 0.15 * uHover;
    }
  }

  float hue = fract(aIndex / float(${POINT_COUNT}) + uTime * 0.02);
  float sat = 0.85;
  float lit = 0.55 + 0.15 * uT01;
  vColor = hsl2rgb(hue, sat, lit);
  vAlpha = 0.75 + uT01 * 0.25;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float d = -mvPosition.z;
  gl_PointSize = clamp(180.0 / d, 1.5, 6.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAG_SHADER = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv);
  if (r > 0.5) discard;

  // soft glowing disc
  float core = 1.0 - smoothstep(0.0, 0.25, r);
  float halo = (1.0 - smoothstep(0.2, 0.5, r)) * 0.35;
  float alpha = (core + halo) * vAlpha;

  gl_FragColor = vec4(vColor + core * 0.4, alpha);
}
`;

const STAR_VERT = `
attribute float aSize;
void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 150.0 / -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`;
const STAR_FRAG = `
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  float a = 1.0 - smoothstep(0.0, 0.5, r);
  gl_FragColor = vec4(0.6, 0.8, 1.0, a * 0.6);
}
`;

export class EmbeddingExplorer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private disposed = false;
  private canvas: HTMLCanvasElement;

  private shapeA: number = 0;
  private shapeB: number = 1;
  private t01 = 0;
  private morphing = false;
  private morphDuration = 2.5;
  private morphTimer = 0;
  private autoMorphTimer = 0;
  private autoMorphInterval = 4.0;

  private hoverPos = new THREE.Vector3();
  private hoverActive = 0;
  private mouse3D = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  private listeners: { el: EventTarget; type: string; fn: any }[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020810);

    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 1000);
    this.camera.position.set(0, 2, 14);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.04;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 40;

    this.addStarfield();
    this.buildPoints();
    this.bindEvents();
  }

  private listen(el: EventTarget, type: string, fn: any) {
    el.addEventListener(type, fn);
    this.listeners.push({ el, type, fn });
  }

  private addStarfield() {
    const count = 2000;
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200 - 50;
      sizes[i] = Math.random() * 0.8 + 0.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  private buildPoints() {
    const sphere = new Float32Array(POINT_COUNT * 3);
    const grid = new Float32Array(POINT_COUNT * 3);
    const helix = new Float32Array(POINT_COUNT * 3);
    const galaxy = new Float32Array(POINT_COUNT * 3);
    const indices = new Float32Array(POINT_COUNT);

    const gridSide = Math.ceil(Math.cbrt(POINT_COUNT));
    const gs = 7.5 / gridSide;

    for (let i = 0; i < POINT_COUNT; i++) {
      // sphere shell
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sr = 4.5 + (Math.random() - 0.5) * 1.2;
      sphere[i * 3] = sr * Math.sin(phi) * Math.cos(theta);
      sphere[i * 3 + 1] = sr * Math.sin(phi) * Math.sin(theta);
      sphere[i * 3 + 2] = sr * Math.cos(phi);

      // structured grid
      const gx = i % gridSide;
      const gy = Math.floor(i / gridSide) % gridSide;
      const gz = Math.floor(i / (gridSide * gridSide));
      grid[i * 3] = (gx - gridSide / 2) * gs;
      grid[i * 3 + 1] = (gy - gridSide / 2) * gs;
      grid[i * 3 + 2] = (gz - gridSide / 2) * gs;

      // double helix DNA
      const t = (i / POINT_COUNT) * Math.PI * 16;
      const strand = i % 2;
      const helixR = 2.8;
      helix[i * 3] = Math.cos(t + strand * Math.PI) * helixR;
      helix[i * 3 + 1] = (i / POINT_COUNT) * 12 - 6;
      helix[i * 3 + 2] = Math.sin(t + strand * Math.PI) * helixR;

      // galaxy spiral arms
      const arm = i % 4;
      const galR = 1.5 + Math.sqrt(i / POINT_COUNT) * 6.0;
      const galAngle = (i / POINT_COUNT) * Math.PI * 10 + arm * (Math.PI / 2);
      galaxy[i * 3] = Math.cos(galAngle) * galR + (Math.random() - 0.5) * 0.6;
      galaxy[i * 3 + 1] = (Math.random() - 0.5) * 0.8;
      galaxy[i * 3 + 2] = Math.sin(galAngle) * galR + (Math.random() - 0.5) * 0.6;

      indices[i] = i;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(sphere.slice(), 3));
    geo.setAttribute("aPos0", new THREE.BufferAttribute(sphere, 3));
    geo.setAttribute("aPos1", new THREE.BufferAttribute(grid, 3));
    geo.setAttribute("aPos2", new THREE.BufferAttribute(helix, 3));
    geo.setAttribute("aPos3", new THREE.BufferAttribute(galaxy, 3));
    geo.setAttribute("aIndex", new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uT01: { value: 0 },
        uShapeA: { value: 0 },
        uShapeB: { value: 1 },
        uTime: { value: 0 },
        uHover: { value: 0 },
        uHoverPos: { value: new THREE.Vector3() },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.scene.add(this.points);
  }

  private bindEvents() {
    this.listen(this.canvas, "mousemove", (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse3D.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse3D.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    });
    this.listen(this.canvas, "mouseenter", () => { this.hoverActive = 1; });
    this.listen(this.canvas, "mouseleave", () => { this.hoverActive = 0; });
  }

  morphTo(shape: number) {
    if (this.morphing) {
      this.shapeA = this.shapeB;
      this.t01 = 0;
    }
    this.shapeB = shape;
    this.morphTimer = 0;
    this.morphing = true;
    this.autoMorphTimer = 0;
  }

  render(delta: number, elapsed: number) {
    if (this.disposed) return;

    // auto morph
    this.autoMorphTimer += delta;
    if (this.autoMorphTimer > this.autoMorphInterval && !this.morphing) {
      this.autoMorphTimer = 0;
      const next = (this.shapeB + 1) % 4;
      this.morphTo(next);
    }

    // animate morph
    if (this.morphing) {
      this.morphTimer += delta;
      const p = Math.min(this.morphTimer / this.morphDuration, 1);
      // ease in-out cubic
      this.t01 = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      if (p >= 1) {
        this.shapeA = this.shapeB;
        this.t01 = 0;
        this.morphing = false;
      }
    }

    // hover raycasting
    if (this.hoverActive && this.material) {
      this.raycaster.setFromCamera(this.mouse3D, this.camera);
      const ray = this.raycaster.ray;
      const t = (-ray.origin.z) / ray.direction.z;
      if (t > 0) {
        this.hoverPos.set(
          ray.origin.x + ray.direction.x * t,
          ray.origin.y + ray.direction.y * t,
          0,
        );
      }
      this.material.uniforms.uHoverPos.value.copy(this.hoverPos);
      this.material.uniforms.uHover.value = this.hoverActive;
    }

    if (this.material) {
      this.material.uniforms.uT01.value = this.t01;
      this.material.uniforms.uShapeA.value = this.shapeA;
      this.material.uniforms.uShapeB.value = this.shapeB;
      this.material.uniforms.uTime.value = elapsed;
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
    if (this.points) { this.points.geometry.dispose(); this.scene.remove(this.points); }
    this.material?.dispose();
  }
}
