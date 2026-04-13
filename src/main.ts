import * as THREE from 'three';
import { parseSvgToPoints } from './svg-parser';
import { ParticleSystem } from './particles';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './style.css';

gsap.registerPlugin(ScrollTrigger);

async function initCanvas(container: HTMLElement, svgContent: string) {
  const canvasEl = document.createElement('canvas');
  canvasEl.style.position = 'absolute';
  canvasEl.style.inset = '0';
  canvasEl.style.width = '100%';
  canvasEl.style.height = '100%';
  container.appendChild(canvasEl);

  const w = container.clientWidth;
  const h = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(0xffffff, 0);

  const scene = new THREE.Scene();

  const aspect = w / h;
  const sizePercent = parseFloat(container.getAttribute('size-canvas') ?? '80');
  const frustumSize = 50 / sizePercent;
  const camera = new THREE.OrthographicCamera(
    -frustumSize * aspect,
    frustumSize * aspect,
    frustumSize,
    -frustumSize,
    0.1,
    100,
  );
  const topOffset = parseFloat(container.getAttribute('top') ?? '0');
  const leftOffset = parseFloat(container.getAttribute('left') ?? '0');
  camera.position.z = 2;
  camera.position.y = (topOffset / 100) * frustumSize * 2;
  camera.position.x = (leftOffset / 100) * frustumSize * aspect * 2;

  const { points: targets, cellSize } = await parseSvgToPoints(svgContent, 2);

  const color = container.getAttribute('color') ?? '#FFB347';

  const particles = new ParticleSystem(targets, {
    color,
    cellSize,
    spread: 2.0,
    reconstructionDuration: 1.8,
    staggerDuration: 2.2,
  });
  scene.add(particles.points);
  particles.updatePointSize(camera, h);

  const raycaster = new THREE.Raycaster();
  const mouseNdc = new THREE.Vector2(9999, 9999);
  const mouseWorld = new THREE.Vector3(9999, 9999, 0);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function onMouseMove(e: MouseEvent) {
    const rect = container.getBoundingClientRect();
    mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, mouseWorld);
  }

  function onMouseLeave() {
    mouseWorld.set(9999, 9999, 0);
  }

  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseleave', onMouseLeave);

  const ro = new ResizeObserver(() => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const a = cw / ch;
    renderer.setSize(cw, ch);
    camera.left = -frustumSize * a;
    camera.right = frustumSize * a;
    camera.top = frustumSize;
    camera.bottom = -frustumSize;
    camera.updateProjectionMatrix();
    particles.updatePointSize(camera, ch);
  });
  ro.observe(container);

  const startTime = performance.now();
  let started = false;

  function elapsed() {
    return (performance.now() - startTime) / 1000;
  }

  function animate() {
    requestAnimationFrame(animate);
    particles.setMouse(mouseWorld);
    particles.update(elapsed());
    renderer.render(scene, camera);
  }

  animate();

  ScrollTrigger.create({
    trigger: container,
    start: '50% bottom',
    markers: false,
    onEnter: () => {
      if (!started) {
        started = true;
        particles.startReconstruction(elapsed());
      }
    },
  });
}

async function init() {
  const svgModules = import.meta.glob('./assets/*.svg', { query: '?raw', eager: true });
  const svgList = Object.values(svgModules).map(m => (m as { default: string }).default);

  if (svgList.length === 0) {
    console.error('ParticleAnimation: no SVG found in assets/');
    return;
  }

  const ids = ['canvas', 'canvas-2', 'canvas-3', 'canvas-4'];

  const found = ids
    .map((id, index) => ({ el: document.getElementById(id), svg: svgList[index] }))
    .filter(({ el, svg }) => el !== null && svg !== undefined);

  console.log(`ParticleAnimation: ${found.length} canvas trouvé(s)`);

  const tasks = found.map(({ el, svg }) => initCanvas(el as HTMLElement, svg));

  await Promise.all(tasks);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
} else {
  init().catch(console.error);
}


