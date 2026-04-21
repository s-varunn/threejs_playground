import * as THREE from "three";

const PARTICLE_COUNT = 65536; // 256x256 power-of-2 for GPU efficiency

const VELOCITY_FRAG = `
precision highp float;
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uDelta;
uniform vec2 uMouse;
uniform float uForce;      // +1 attract, -1 repel, 0 none
uniform float uBlast;      // 0-1, explosion pulse
uniform vec2 uBlastPos;
uniform float uTime;

// Simple 2D noise
float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;

  // gravity
  vel.y -= 0.00005;

  // turbulence noise
  float n = hash(pos.xy * 4.0 + uTime * 0.1) * 2.0 - 1.0;
  vel.xy += vec2(n, -n) * 0.00002;

  // mouse attract / repel
  if (abs(uForce) > 0.01) {
    vec2 diff = uMouse - pos.xy;
    float dist = length(diff);
    if (dist < 0.7 && dist > 0.001) {
      float strength = 0.0006 / (dist * dist + 0.01);
      vel.xy += normalize(diff) * strength * uForce;
    }
  }

  // explosion blast
  if (uBlast > 0.01) {
    vec2 diff = pos.xy - uBlastPos;
    float dist = length(diff);
    if (dist < 0.6 && dist > 0.001) {
      vel.xy += normalize(diff) * uBlast * 0.04 / (dist + 0.01);
    }
  }

  // boundary bounce
  if (pos.x < -1.0 || pos.x > 1.0) vel.x *= -0.7;
  if (pos.y < -1.0 || pos.y > 1.0) vel.y *= -0.7;

  // damping
  vel *= 0.993;

  // speed limit
  float speed = length(vel);
  if (speed > 0.035) vel = normalize(vel) * 0.035;

  gl_FragColor = vec4(vel, 1.0);
}
`;

const POSITION_FRAG = `
precision highp float;
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uDelta;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  pos += vel * uDelta;
  if (pos.x < -1.0) pos.x = -1.0;
  if (pos.x >  1.0) pos.x =  1.0;
  if (pos.y < -1.0) pos.y = -1.0;
  if (pos.y >  1.0) pos.y =  1.0;
  gl_FragColor = vec4(pos, 1.0);
}
`;

const PARTICLE_VERT = `
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uTime;
varying float vSpeed;
varying vec2 vPos;

void main() {
  vec2 uv = position.xy * 0.5 + 0.5;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);

  vSpeed = length(vel.xy);
  vPos = pos.xy;

  vec4 mvPosition = modelViewMatrix * vec4(pos.xy, 0.0, 1.0);
  // Distance to center for size variation
  float dist = length(pos.xy);
  gl_PointSize = 2.5 + vSpeed * 60.0;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PARTICLE_FRAG = `
varying float vSpeed;
varying vec2 vPos;
uniform float uTime;

vec3 palette(float t) {
  // vivid plasma gradient: slow = deep indigo, fast = neon cyan/white
  vec3 a = vec3(0.08, 0.15, 0.55);
  vec3 b = vec3(0.3,  0.4,  0.5);
  vec3 c = vec3(1.0,  0.8,  0.5);
  vec3 d = vec3(0.0,  0.2,  0.5);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv);
  if (r > 0.5) discard;

  float speed01 = clamp(vSpeed / 0.03, 0.0, 1.0);
  vec3 color = palette(speed01);

  // soft glow core
  float alpha = (1.0 - smoothstep(0.0, 0.5, r)) * (0.6 + speed01 * 0.4);

  gl_FragColor = vec4(color, alpha);
}
`;

// Cursor pulse shader for the mouse indicator overlay
const CURSOR_VERT = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CURSOR_FRAG = `
uniform vec2 uCenter;
uniform float uRadius;
uniform float uPulse;
uniform vec3 uColor;
uniform vec2 uResolution;

void main() {
  vec2 fragPos = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  fragPos.y *= -1.0;
  float dist = length(fragPos - uCenter);
  float ring = smoothstep(uRadius + 0.01, uRadius, dist) * smoothstep(uRadius - 0.03, uRadius, dist);
  float inner = smoothstep(0.02, 0.0, dist) * 0.5;
  float alpha = (ring * (0.5 + uPulse * 0.5) + inner) * 0.8;
  gl_FragColor = vec4(uColor * (1.0 + uPulse), alpha);
}
`;

export class PhysicsScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private cursorScene: THREE.Scene;
  private gpuCompute: GPUComputationRenderer | null = null;
  private posVar: any;
  private velVar: any;
  private particleMesh: THREE.Points | null = null;
  private particleMaterial: THREE.ShaderMaterial | null = null;
  private cursorMaterial: THREE.ShaderMaterial | null = null;
  private mousePos = new THREE.Vector2(0, 0);
  private mouseForce = 0;
  private blastPulse = 0;
  private blastPos = new THREE.Vector2(0, 0);
  private disposed = false;
  private canvas: HTMLCanvasElement;
  private time = 0;
  private listeners: { el: EventTarget; type: string; fn: any }[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.renderer.setBlending = undefined as any;

    this.scene = new THREE.Scene();
    this.cursorScene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    this.initGPU();
    this.initParticles();
    this.initCursor();
    this.bindEvents();
  }

  private listen(el: EventTarget, type: string, fn: any) {
    el.addEventListener(type, fn);
    this.listeners.push({ el, type, fn });
  }

  private initGPU() {
    const size = 256; // 256*256 = 65536
    this.gpuCompute = new GPUComputationRenderer(size, size, this.renderer);

    const posData = this.gpuCompute.createTexture();
    const velData = this.gpuCompute.createTexture();
    const pArr = posData.image.data as Float32Array;
    const vArr = velData.image.data as Float32Array;

    // Burst spawn from center
    for (let i = 0; i < pArr.length; i += 4) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.6;
      pArr[i] = Math.cos(angle) * r;
      pArr[i + 1] = Math.sin(angle) * r;
      pArr[i + 2] = 0;
      pArr[i + 3] = 1;
      vArr[i] = (Math.random() - 0.5) * 0.004;
      vArr[i + 1] = (Math.random() - 0.5) * 0.004;
      vArr[i + 2] = 0;
      vArr[i + 3] = 1;
    }

    this.velVar = this.gpuCompute.addVariable("textureVelocity", VELOCITY_FRAG, velData);
    this.posVar = this.gpuCompute.addVariable("texturePosition", POSITION_FRAG, posData);
    this.gpuCompute.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    this.gpuCompute.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);

    this.velVar.material.uniforms.uDelta = { value: 1.0 };
    this.velVar.material.uniforms.uMouse = { value: new THREE.Vector2(0, 0) };
    this.velVar.material.uniforms.uForce = { value: 0 };
    this.velVar.material.uniforms.uBlast = { value: 0 };
    this.velVar.material.uniforms.uBlastPos = { value: new THREE.Vector2(0, 0) };
    this.velVar.material.uniforms.uTime = { value: 0 };
    this.posVar.material.uniforms.uDelta = { value: 1.0 };

    this.gpuCompute.init();
  }

  private initParticles() {
    const size = 256;
    const total = size * size;
    const positions = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const u = (i % size) / (size - 1);
      const v = Math.floor(i / size) / (size - 1);
      positions[i * 3] = u * 2 - 1;
      positions[i * 3 + 1] = v * 2 - 1;
      positions[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null },
        textureVelocity: { value: null },
        uTime: { value: 0 },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particleMesh = new THREE.Points(geo, this.particleMaterial);
    this.scene.add(this.particleMesh);
  }

  private initCursor() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.cursorMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: 0.14 },
        uPulse: { value: 0 },
        uColor: { value: new THREE.Vector3(0, 0.8, 1.0) },
        uResolution: {
          value: new THREE.Vector2(this.canvas.clientWidth, this.canvas.clientHeight),
        },
      },
      vertexShader: CURSOR_VERT,
      fragmentShader: CURSOR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, this.cursorMaterial);
    this.cursorScene.add(mesh);
  }

  private bindEvents() {
    this.listen(this.canvas, "mousemove", (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      this.mousePos.set(x, y);
    });

    this.listen(this.canvas, "mousedown", (e: MouseEvent) => {
      e.preventDefault();
      this.mouseForce = e.button === 2 ? -1 : 1;
    });

    this.listen(window, "mouseup", () => { this.mouseForce = 0; });

    this.listen(this.canvas, "contextmenu", (e: Event) => e.preventDefault());

    this.listen(this.canvas, "dblclick", (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      this.blastPos.set(x, y);
      this.blastPulse = 1.0;
    });

    // Touch support
    this.listen(this.canvas, "touchstart", (e: TouchEvent) => {
      e.preventDefault();
      this.mouseForce = 1;
      this.updateTouchPos(e);
    });
    this.listen(this.canvas, "touchmove", (e: TouchEvent) => {
      e.preventDefault();
      this.updateTouchPos(e);
    });
    this.listen(this.canvas, "touchend", () => { this.mouseForce = 0; });
  }

  private updateTouchPos(e: TouchEvent) {
    if (!e.touches[0]) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.touches[0].clientY - rect.top) / rect.height) * 2 - 1);
    this.mousePos.set(x, y);
  }

  render(delta: number) {
    if (!this.gpuCompute || this.disposed) return;
    this.time += delta;
    this.blastPulse *= 0.88;

    const dt = delta * 60;
    this.velVar.material.uniforms.uDelta.value = dt;
    this.velVar.material.uniforms.uMouse.value = this.mousePos;
    this.velVar.material.uniforms.uForce.value = this.mouseForce;
    this.velVar.material.uniforms.uBlast.value = this.blastPulse;
    this.velVar.material.uniforms.uBlastPos.value = this.blastPos;
    this.velVar.material.uniforms.uTime.value = this.time;
    this.posVar.material.uniforms.uDelta.value = dt;

    this.gpuCompute.compute();

    if (this.particleMaterial) {
      this.particleMaterial.uniforms.texturePosition.value =
        this.gpuCompute.getCurrentRenderTarget(this.posVar).texture;
      this.particleMaterial.uniforms.textureVelocity.value =
        this.gpuCompute.getCurrentRenderTarget(this.velVar).texture;
      this.particleMaterial.uniforms.uTime.value = this.time;
    }

    if (this.cursorMaterial) {
      const isRepel = this.mouseForce < 0;
      this.cursorMaterial.uniforms.uCenter.value = this.mousePos;
      this.cursorMaterial.uniforms.uPulse.value =
        Math.abs(this.mouseForce) > 0.01 ? 0.5 + 0.5 * Math.sin(this.time * 8) : 0.0;
      this.cursorMaterial.uniforms.uColor.value.set(
        isRepel ? 1.0 : 0.0,
        isRepel ? 0.2 : 0.8,
        isRepel ? 0.1 : 1.0
      );
      this.cursorMaterial.uniforms.uResolution.value.set(
        this.canvas.clientWidth,
        this.canvas.clientHeight
      );
    }

    this.renderer.setClearColor(0x020610);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.render(this.cursorScene, this.camera);
    this.renderer.autoClear = true;
  }

  dispose() {
    this.disposed = true;
    for (const { el, type, fn } of this.listeners) el.removeEventListener(type, fn);
    this.listeners = [];

    if (this.particleMesh) {
      this.particleMesh.geometry.dispose();
      this.scene.remove(this.particleMesh);
    }
    this.particleMaterial?.dispose();
    this.cursorMaterial?.dispose();

    if (this.gpuCompute) {
      const g = this.gpuCompute as any;
      if (g.variables) {
        for (const v of g.variables) {
          if (v.renderTargets) for (const rt of v.renderTargets) rt.dispose();
          v.material?.dispose();
        }
      }
    }
  }
}

// ─── Minimal GPGPU Renderer ───────────────────────────────────────────────────
class GPUComputationRenderer {
  private width: number;
  private height: number;
  private renderer: THREE.WebGLRenderer;
  private variables: any[] = [];
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private passThruUniforms: any;
  private passThruShader: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;

  constructor(sizeX: number, sizeY: number, renderer: THREE.WebGLRenderer) {
    this.width = sizeX;
    this.height = sizeY;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.camera.position.z = 1;

    this.passThruUniforms = { passThruTexture: { value: null } };
    this.passThruShader = new THREE.ShaderMaterial({
      uniforms: this.passThruUniforms,
      vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D passThruTexture;
        void main() {
          vec2 uv = gl_FragCoord.xy / vec2(${sizeX}.0, ${sizeY}.0);
          gl_FragColor = texture2D(passThruTexture, uv);
        }`,
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geo, this.passThruShader);
    this.scene.add(this.mesh);
  }

  createTexture(): THREE.DataTexture {
    const data = new Float32Array(this.width * this.height * 4);
    const tex = new THREE.DataTexture(data, this.width, this.height, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
  }

  addVariable(name: string, frag: string, initTex: THREE.DataTexture) {
    const material = new THREE.ShaderMaterial({
      uniforms: { resolution: { value: new THREE.Vector2(this.width, this.height) } },
      vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `#define resolution vec2(${this.width}.0,${this.height}.0)\n${frag}`,
    });
    const variable = {
      name, initialValueTexture: initTex, material, dependencies: [] as any[],
      renderTargets: [this.createRT(), this.createRT()], currentRTIndex: 0,
    };
    this.variables.push(variable);
    return variable;
  }

  private createRT() {
    return new THREE.WebGLRenderTarget(this.width, this.height, {
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.FloatType, depthBuffer: false,
    });
  }

  setVariableDependencies(v: any, deps: any[]) { v.dependencies = deps; }

  init() {
    for (const v of this.variables) {
      this.blit(v.initialValueTexture, v.renderTargets[0]);
      this.blit(v.initialValueTexture, v.renderTargets[1]);
    }
    return null;
  }

  compute() {
    for (const v of this.variables) {
      const next = v.currentRTIndex === 0 ? 1 : 0;
      for (const dep of v.dependencies)
        v.material.uniforms[dep.name] = { value: dep.renderTargets[dep.currentRTIndex].texture };
      this.mesh.material = v.material;
      this.renderer.setRenderTarget(v.renderTargets[next]);
      this.renderer.render(this.scene, this.camera);
      v.currentRTIndex = next;
    }
    this.renderer.setRenderTarget(null);
    this.mesh.material = this.passThruShader;
  }

  getCurrentRenderTarget(v: any) { return v.renderTargets[v.currentRTIndex]; }

  private blit(src: THREE.Texture, dst: THREE.WebGLRenderTarget) {
    this.passThruUniforms.passThruTexture.value = src;
    this.mesh.material = this.passThruShader;
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }
}
