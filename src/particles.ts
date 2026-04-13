import * as THREE from 'three';
import type { ParticleTarget } from './svg-parser';

const VERTEX_SHADER = /* glsl */ `
  attribute float opacity;
  uniform float uPointSize;
  varying float vOpacity;

  void main() {
    vOpacity = opacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vOpacity;

  void main() {
    gl_FragColor = vec4(uColor, vOpacity);
  }
`;

export interface ParticleSystemOptions {
  color?: string;
  cellSize?: number;
  spread?: number;
  reconstructionDuration?: number;
  staggerDuration?: number;
}

const EASE_COUNT = 5;

function easeGravityHard(t: number): number {
  if (t < 0.35) return 2.5 * t * t;
  const p = (t - 0.35) / 0.65;
  return 0.306 + 0.694 * (1 - Math.pow(1 - p, 4));
}

function easeSlow(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function easeFloaty(t: number): number {
  return t * t * (3 - 2 * t);
}

function easeSwoop(t: number): number {
  if (t < 0.2) return 0.5 * t * t * 25;
  const p = (t - 0.2) / 0.8;
  return 0.5 + 0.5 * (1 - Math.pow(1 - p, 2.5));
}

function easeAccelerate(t: number): number {
  if (t < 0.5) return 2 * t * t;
  const p = (t - 0.5) / 0.5;
  return 0.5 + 0.5 * (1 - Math.pow(1 - p, 3));
}

function applyEase(t: number, easeType: number): number {
  switch (easeType) {
    case 0: return easeGravityHard(t);
    case 1: return easeSlow(t);
    case 2: return easeFloaty(t);
    case 3: return easeSwoop(t);
    case 4: return easeAccelerate(t);
    default: return easeFloaty(t);
  }
}

export class ParticleSystem {
  readonly points: THREE.Points;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  private count: number;
  private origins: Float32Array;
  private startPositions: Float32Array;
  private positions: Float32Array;
  private velocities: Float32Array;
  private opacities: Float32Array;
  private delays: Float32Array;
  private durations: Float32Array;
  private driftX: Float32Array;
  private driftFreq: Float32Array;
  private startOpacities: Float32Array;
  private easeTypes: Uint8Array;
  private wobblePhase: Float32Array;
  private wobbleAmp: Float32Array;

  private maxDuration: number;

  private isReconstructed = false;
  private reconstructionStartTime = -1;

  private mouseWorld = new THREE.Vector3(9999, 9999, 0);
  private prevMouseWorld = new THREE.Vector3(9999, 9999, 0);
  private mouseVelocity = 0;

  constructor(targets: ParticleTarget[], options: ParticleSystemOptions = {}) {
    const {
      color = '#FE7800',
      cellSize = 0.01,
      spread = 2.0,
      reconstructionDuration = 1.4,
      staggerDuration = 2.2,
    } = options;

    this.count = targets.length;
    this.maxDuration = 0;

    this.origins = new Float32Array(this.count * 3);
    this.startPositions = new Float32Array(this.count * 3);
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.opacities = new Float32Array(this.count);
    this.delays = new Float32Array(this.count);
    this.durations = new Float32Array(this.count);
    this.driftX = new Float32Array(this.count);
    this.driftFreq = new Float32Array(this.count);
    this.startOpacities = new Float32Array(this.count);
    this.easeTypes = new Uint8Array(this.count);
    this.wobblePhase = new Float32Array(this.count);
    this.wobbleAmp = new Float32Array(this.count);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const t of targets) {
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
    }
    const rangeY = maxY - minY || 1;

    for (let i = 0; i < this.count; i++) {
      const t = targets[i];
      const i3 = i * 3;

      this.origins[i3] = t.x;
      this.origins[i3 + 1] = t.y;
      this.origins[i3 + 2] = 0;

      const sx = (Math.random() - 0.5) * spread * 2.5;
      const sy = 1.3 + Math.random() * 1.5;

      this.startPositions[i3] = sx;
      this.startPositions[i3 + 1] = sy;
      this.startPositions[i3 + 2] = 0;

      this.positions[i3] = sx;
      this.positions[i3 + 1] = sy;
      this.positions[i3 + 2] = 0;

      this.velocities[i3] = 0;
      this.velocities[i3 + 1] = 0;
      this.velocities[i3 + 2] = 0;

      this.startOpacities[i] = 0.3 + Math.random() * 0.7;
      this.opacities[i] = this.startOpacities[i];

      const normalizedY = (t.y - minY) / rangeY;
      const jitter = (Math.random() - 0.5) * staggerDuration * 0.5;
      this.delays[i] = Math.max(0, normalizedY * staggerDuration + jitter);

      this.durations[i] = reconstructionDuration * (0.5 + Math.random() * 1.0);

      this.driftX[i] = (Math.random() - 0.5) * 0.6;
      this.driftFreq[i] = 0.8 + Math.random() * 1.5;

      this.easeTypes[i] = Math.floor(Math.random() * EASE_COUNT);

      this.wobblePhase[i] = Math.random() * Math.PI * 2;
      this.wobbleAmp[i] = 0.005 + Math.random() * 0.02;

      const endTime = this.delays[i] + this.durations[i];
      if (endTime > this.maxDuration) this.maxDuration = endTime;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('opacity', new THREE.BufferAttribute(this.opacities, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uPointSize: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this._cellSize = cellSize;
  }

  private _cellSize: number;

  updatePointSize(camera: THREE.OrthographicCamera, viewportHeight: number) {
    const cameraHeight = camera.top - camera.bottom;
    const pixelSize = (this._cellSize / cameraHeight) * viewportHeight * window.devicePixelRatio;
    this.material.uniforms.uPointSize.value = Math.ceil(pixelSize) + 1.5;
  }

  startReconstruction(time: number) {
    this.reconstructionStartTime = time;
    this.isReconstructed = false;
  }

  setMouse(worldPos: THREE.Vector3) {
    this.prevMouseWorld.copy(this.mouseWorld);
    this.mouseWorld.copy(worldPos);
    const dx = this.mouseWorld.x - this.prevMouseWorld.x;
    const dy = this.mouseWorld.y - this.prevMouseWorld.y;
    this.mouseVelocity = Math.sqrt(dx * dx + dy * dy);
  }

  update(time: number) {
    if (this.reconstructionStartTime < 0) return;

    const elapsed = time - this.reconstructionStartTime;

    if (elapsed >= this.maxDuration + 0.2) {
      this.isReconstructed = true;
    }

    const mouseRadius = 0.25;
    const rawVel = Math.max(0, this.mouseVelocity - 0.003);
    const velocityForce = Math.min(rawVel * rawVel * 80, 0.04);

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;

      const ox = this.origins[i3];
      const oy = this.origins[i3 + 1];
      const oz = this.origins[i3 + 2];

      if (!this.isReconstructed) {
        const particleElapsed = elapsed - this.delays[i];
        const t = Math.max(0, Math.min(1, particleElapsed / this.durations[i]));
        const eased = applyEase(t, this.easeTypes[i]);

        const sx = this.startPositions[i3];
        const sy = this.startPositions[i3 + 1];
        const sz = this.startPositions[i3 + 2];

        const driftPhase = t * Math.PI * this.driftFreq[i];
        const drift = this.driftX[i] * Math.sin(driftPhase) * (1 - t);

        const wobble = t > 0 && t < 1
          ? Math.sin(time * 12 + this.wobblePhase[i]) * this.wobbleAmp[i] * (1 - t)
          : 0;

        let px = sx + (ox - sx) * eased + drift + wobble;
        let py = sy + (oy - sy) * eased;
        const pz = sz + (oz - sz) * eased;

        let vx = this.velocities[i3];
        let vy = this.velocities[i3 + 1];

        if (velocityForce > 0.001) {
          const dx = ox - this.mouseWorld.x;
          const dy = oy - this.mouseWorld.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < mouseRadius && dist > 0.001) {
            const falloff = 1 - dist / mouseRadius;
            const force = falloff * falloff * velocityForce;
            const spreadAngle = (Math.random() - 0.5) * 2.0;
            const baseAngle = Math.atan2(dy, dx);
            const angle = baseAngle + spreadAngle;
            const particleVariation = 0.5 + Math.random() * 1.0;
            vx += Math.cos(angle) * force * particleVariation;
            vy += Math.sin(angle) * force * particleVariation;
          }
        }

        vx *= 0.94;
        vy *= 0.94;

        px += vx;
        py += vy;

        this.velocities[i3] = vx;
        this.velocities[i3 + 1] = vy;

        this.positions[i3] = px;
        this.positions[i3 + 1] = py;
        this.positions[i3 + 2] = pz;

        const startOp = this.startOpacities[i];
        this.opacities[i] = t > 0 ? startOp + (1 - startOp) * Math.min(1, t * 2) : startOp;
      } else {
        let px = this.positions[i3];
        let py = this.positions[i3 + 1];
        let pz = this.positions[i3 + 2];

        let vx = this.velocities[i3];
        let vy = this.velocities[i3 + 1];
        let vz = this.velocities[i3 + 2];

        if (velocityForce > 0.001) {
          const dx = px - this.mouseWorld.x;
          const dy = py - this.mouseWorld.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < mouseRadius && dist > 0.001) {
            const falloff = 1 - dist / mouseRadius;
            const force = falloff * falloff * velocityForce;
            const spreadAngle = (Math.random() - 0.5) * 2.0;
            const baseAngle = Math.atan2(dy, dx);
            const angle = baseAngle + spreadAngle;
            const particleVariation = 0.5 + Math.random() * 1.0;
            vx += Math.cos(angle) * force * particleVariation;
            vy += Math.sin(angle) * force * particleVariation;
          }
        }

        vx *= 0.94;
        vy *= 0.94;
        vz *= 0.94;

        px += vx;
        py += vy;
        pz += vz;

        const lerpSpeed = 0.035;
        px += (ox - px) * lerpSpeed;
        py += (oy - py) * lerpSpeed;
        pz += (oz - pz) * lerpSpeed;

        this.positions[i3] = px;
        this.positions[i3 + 1] = py;
        this.positions[i3 + 2] = pz;

        this.velocities[i3] = vx;
        this.velocities[i3 + 1] = vy;
        this.velocities[i3 + 2] = vz;

        this.opacities[i] = 1;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.opacity.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}


