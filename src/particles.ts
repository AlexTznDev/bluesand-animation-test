import * as THREE from 'three';
import type { ParticleTarget } from './svg-parser';

const VERTEX_SHADER = /* glsl */ `
  attribute vec3  aStart;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  attribute vec2  aOffset;

  uniform float uOpacity;
  uniform float uGather;
  uniform float uDirection;      // 0 = ltr, 1 = ttb, 2 = btt
  uniform float uFunnelStrength; // 0 = pas d'entonnoir, 1 = entonnoir plein
  uniform float uPointSize;

  varying float vAlpha;

  void main() {
    // Wave direction: 0=LTR, 1=TTB, 2=BTT
    float waveNorm = uDirection < 0.5
      ? clamp((position.x + 0.5), 0.0, 1.0)          // LTR: left first
      : (uDirection < 1.5
        ? clamp((-position.y + 0.5), 0.0, 1.0)        // TTB: top first
        : clamp((position.y + 0.5), 0.0, 1.0));        // BTT: bottom first

    float delay  = clamp(pow(waveNorm, 0.7) * 0.96 + sin(aPhase) * 0.03, 0.0, 0.98);
    float localT = clamp((uGather - delay) / max(0.01, 1.0 - delay), 0.0, 1.0);

    float drag   = 2.8 + (1.0 - aSpeed) * 2.0;
    float tEased = 1.0 - pow(1.0 - localT, drag);
    float t      = tEased;

    // Bezier entonnoir — uFunnelStrength contrôle l'intensité de la convergence
    float ctrlX = uDirection < 0.5
      ? mix(aStart.x, position.x, 0.7)
      : mix(position.x, 0.0, uFunnelStrength);
    float ctrlY = uDirection < 0.5
      ? mix(position.y, 0.0, uFunnelStrength)
      : mix(aStart.y, position.y, 0.7);

    vec3 pos;
    pos.x = (1.0-t)*(1.0-t)*aStart.x + 2.0*(1.0-t)*t*ctrlX + t*t*position.x;
    pos.y = (1.0-t)*(1.0-t)*aStart.y + 2.0*(1.0-t)*t*ctrlY + t*t*position.y;
    pos.z = 0.0;

    // CPU hover offset
    pos.xy += aOffset;

    vAlpha = uOpacity * smoothstep(0.0, 0.08, localT);

    gl_Position  = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uPointSize * aSize;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv);
    float a  = 1.0 - smoothstep(0.48, 0.5, d);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * vAlpha);
  }
`;

export type Direction = 'ltr' | 'ttb' | 'btt';

export interface ParticleSystemOptions {
  color?:          string;
  cellSize?:       number;
  spread?:         number;
  direction?:      Direction;
  funnelStrength?: number;
}

function gauss(sigma = 1): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  readonly uniforms: {
    uOpacity:        { value: number };
    uGather:         { value: number };
    uDirection:      { value: number };
    uFunnelStrength: { value: number };
    uColor:          { value: THREE.Color };
    uPointSize:      { value: number };
  };

  private geometry:  THREE.BufferGeometry;
  private material:  THREE.ShaderMaterial;
  private cellSize:  number;
  private count:     number;

  private origins:   Float32Array;
  private hoverVel:  Float32Array;
  private hoverOff:  Float32Array;

  private mouseX      = 9999;
  private mouseY      = 9999;
  private mouseVel    = 0;
  private hoverActive = false;

  constructor(targets: ParticleTarget[], options: ParticleSystemOptions = {}) {
    const {
      color          = '#FFB347',
      cellSize       = 0.01,
      spread         = 0.35,
      direction      = 'ltr',
      funnelStrength = 1.0,
    } = options;

    this.cellSize = cellSize;
    this.count    = targets.length;

    const positions = new Float32Array(this.count * 3);
    const aStart    = new Float32Array(this.count * 3);
    const aPhase    = new Float32Array(this.count);
    const aSpeed    = new Float32Array(this.count);
    const aSize     = new Float32Array(this.count);
    const aOffset   = new Float32Array(this.count * 2);

    this.origins  = new Float32Array(this.count * 2);
    this.hoverVel = new Float32Array(this.count * 2);
    this.hoverOff = new Float32Array(this.count * 2);

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const i2 = i * 2;
      const t  = targets[i];

      positions[i3]     = t.x;
      positions[i3 + 1] = t.y;
      positions[i3 + 2] = 0;

      this.origins[i2]     = t.x;
      this.origins[i2 + 1] = t.y;

      if (direction === 'ltr') {
        aStart[i3]     = spread * 1.4 + gauss(spread * 0.15);
        aStart[i3 + 1] = gauss(spread * 0.8);
      } else if (direction === 'ttb') {
        aStart[i3]     = gauss(spread * 0.8);
        aStart[i3 + 1] = spread * 1.4 + gauss(spread * 0.15);
      } else {
        // BTT
        aStart[i3]     = gauss(spread * 0.8);
        aStart[i3 + 1] = spread * 1.4 + gauss(spread * 0.15);
      }
      aStart[i3 + 2] = 0;

      aPhase[i] = Math.random() * Math.PI * 2;
      aSpeed[i] = Math.random() * 0.3 + 0.08;
      aSize[i]  = 0.86;
    }

    this.uniforms = {
      uOpacity:        { value: 0 },
      uGather:         { value: 0 },
      uDirection:      { value: direction === 'ltr' ? 0 : direction === 'ttb' ? 1 : 2 },
      uFunnelStrength: { value: funnelStrength },
      uColor:          { value: new THREE.Color(color) },
      uPointSize:      { value: 2 },
    };

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aStart',   new THREE.BufferAttribute(aStart,    3));
    this.geometry.setAttribute('aPhase',   new THREE.BufferAttribute(aPhase,    1));
    this.geometry.setAttribute('aSpeed',   new THREE.BufferAttribute(aSpeed,    1));
    this.geometry.setAttribute('aSize',    new THREE.BufferAttribute(aSize,     1));
    this.geometry.setAttribute('aOffset',  new THREE.BufferAttribute(aOffset,   2));

    this.material = new THREE.ShaderMaterial({
      vertexShader:   VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms:       this.uniforms as Record<string, THREE.IUniform>,
      transparent:    true,
      depthWrite:     false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
  }

  updatePointSize(camera: THREE.OrthographicCamera, viewportHeight: number, pixelRatio?: number) {
    const cameraHeight = camera.top - camera.bottom;
    const dpr = pixelRatio ?? Math.min(window.devicePixelRatio, 2);
    const effectivePixels = Math.min(viewportHeight * dpr, 1800);
    const pixelSize = (this.cellSize / cameraHeight) * effectivePixels;
    this.uniforms.uPointSize.value = Math.ceil(pixelSize * 1.45 + 1.5);
  }

  setMouse(x: number, y: number, ndcVelocity = 0) {
    const isSentinel  = x > 9000 || y > 9000;
    const wasSentinel = this.mouseX > 9000 || this.mouseY > 9000;
    this.mouseX  = x;
    this.mouseY  = y;
    this.mouseVel = (wasSentinel || isSentinel) ? 0 : ndcVelocity;
  }

  tick() {
    if (this.uniforms.uGather.value < 0.98) return;

    const mouseRadius   = 0.25;
    const rawVel        = Math.max(0, this.mouseVel - 0.003);
    const velocityForce = Math.min(rawVel * rawVel * 80, 0.04);
    this.mouseVel      *= 0.8;

    if (!this.hoverActive && velocityForce <= 0.001) return;

    const lerpSpeed = 0.035;
    const damping   = 0.94;
    const SNAP      = 0.00008;

    const offAttr = this.geometry.getAttribute('aOffset') as THREE.BufferAttribute;
    let anyActive = false;

    for (let i = 0; i < this.count; i++) {
      const i2 = i * 2;
      const ox = this.origins[i2];
      const oy = this.origins[i2 + 1];

      let vx   = this.hoverVel[i2];
      let vy   = this.hoverVel[i2 + 1];
      let offX = this.hoverOff[i2];
      let offY = this.hoverOff[i2 + 1];

      if (velocityForce > 0.001) {
        const px   = ox + offX;
        const py   = oy + offY;
        const dx   = px - this.mouseX;
        const dy   = py - this.mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < mouseRadius && dist > 0.001) {
          const falloff   = 1 - dist / mouseRadius;
          const force     = falloff * falloff * velocityForce;
          const angle     = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2.0;
          const variation = 0.5 + Math.random() * 1.0;
          vx += Math.cos(angle) * force * variation;
          vy += Math.sin(angle) * force * variation;
        }
      }

      vx *= damping;
      vy *= damping;
      offX += vx;
      offY += vy;
      offX += -offX * lerpSpeed;
      offY += -offY * lerpSpeed;

      if (Math.abs(vx) < SNAP && Math.abs(vy) < SNAP &&
          Math.abs(offX) < SNAP && Math.abs(offY) < SNAP) {
        vx = 0; vy = 0; offX = 0; offY = 0;
      } else {
        anyActive = true;
      }

      this.hoverVel[i2]     = vx;
      this.hoverVel[i2 + 1] = vy;
      this.hoverOff[i2]     = offX;
      this.hoverOff[i2 + 1] = offY;
      offAttr.setXY(i, offX, offY);
    }

    offAttr.needsUpdate = true;
    this.hoverActive = anyActive;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
