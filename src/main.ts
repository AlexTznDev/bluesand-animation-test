import * as THREE from 'three';
import { parseSvgToPoints } from './svg-parser';
import { ParticleSystem } from './particles';
import './style.css';
import svgContent from './assets/Union.svg?raw';

async function init() {
  const container = document.getElementById('canvas');
  if (!container) {
    console.error('ParticleAnimation: no element with id="canvas" found.');
    return;
  }

  const canvasEl = document.createElement('canvas');
  canvasEl.style.display = 'block';
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
  const frustumSize = 1.2;
  const camera = new THREE.OrthographicCamera(
    -frustumSize * aspect,
    frustumSize * aspect,
    frustumSize,
    -frustumSize,
    0.1,
    100,
  );
  camera.position.z = 2;

  const { points: targets, cellSize } = await parseSvgToPoints(svgContent, 3);

  const particles = new ParticleSystem(targets, {
    color: '#FFB347',
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
    const rect = container!.getBoundingClientRect();
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
    const cw = container!.clientWidth;
    const ch = container!.clientHeight;
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

  const clock = new THREE.Clock();
  particles.startReconstruction(0);

  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    particles.setMouse(mouseWorld);
    particles.update(elapsed);

    renderer.render(scene, camera);
  }

  animate();
}

init().catch(console.error);
