import * as THREE from 'three';
import { parseSvgToPoints } from './svg-parser';
import { ParticleSystem, type Direction } from './particles';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './style.css';

gsap.registerPlugin(ScrollTrigger);

async function initCanvas(container: HTMLElement, svgContent: string) {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const aspect = w / h;

  container.style.position = 'absolute';

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const sizePercent = parseFloat(container.getAttribute('size-canvas') ?? '80');
  const frustumSize = 50 / sizePercent;
  const topOffset   = parseFloat(container.getAttribute('top')  ?? '0');
  const leftOffset  = parseFloat(container.getAttribute('left') ?? '0');

  const camera = new THREE.OrthographicCamera(
    -frustumSize * aspect,
     frustumSize * aspect,
     frustumSize,
    -frustumSize,
    0.1,
    100,
  );
  camera.position.z = 2;
  camera.position.y = (topOffset  / 100) * frustumSize * 2;
  camera.position.x = (leftOffset / 100) * frustumSize * aspect * 2;

  const { points: targets, cellSize } = await parseSvgToPoints(svgContent, 2);
  const color = container.getAttribute('color') ?? '#FFB347';

  const direction      = (container.getAttribute('direction') ?? 'ltr') as Direction;
  const funnelStrength = parseFloat(container.getAttribute('funnel-strength') ?? '1.0');

  const particles = new ParticleSystem(targets, {
    color,
    cellSize,
    spread: 0.55,
    direction,
    funnelStrength,
  });
  scene.add(particles.points);
  particles.updatePointSize(camera, h, renderer.getPixelRatio());

  // Mouse → world-space repulsion
  const raycaster  = new THREE.Raycaster();
  const mouseNdc   = new THREE.Vector2(9999, 9999);
  const prevNdc    = new THREE.Vector2(9999, 9999);
  const mouseWorld = new THREE.Vector3();
  const plane      = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function onMouseMove(e: MouseEvent) {
    const rect = container.getBoundingClientRect();
    prevNdc.copy(mouseNdc);
    mouseNdc.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
    mouseNdc.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
    const ndcVel = prevNdc.x > 9000 ? 0 : mouseNdc.distanceTo(prevNdc);
    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, mouseWorld);
    particles.setMouse(mouseWorld.x, mouseWorld.y, ndcVel);
  }

  container.addEventListener('mousemove',  onMouseMove);
  container.addEventListener('mouseleave', () => {
    mouseNdc.set(9999, 9999);
    particles.setMouse(9999, 9999);
  });

  // Resize
  const ro = new ResizeObserver(() => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const a  = cw / ch;
    renderer.setSize(cw, ch);
    camera.left  = -frustumSize * a;
    camera.right =  frustumSize * a;
    camera.updateProjectionMatrix();
    particles.updatePointSize(camera, ch, renderer.getPixelRatio());
  });
  ro.observe(container);

  // Render loop — piloté par ScrollTrigger
  let running = false;
  function tick() {
    if (!running) return;
    particles.tick();
    renderer.render(scene, camera);
  }

  ScrollTrigger.create({
    trigger: container,
    start:   'top 95%',
    markers: false,
    onEnter: () => {
      if (running) return;
      running = true;
      gsap.ticker.add(tick);

      gsap.timeline()
        .to(particles.uniforms.uOpacity, { value: 1, duration: 0.5, ease: 'power2.out' })
        .to(particles.uniforms.uGather,  { value: 1, duration: 7.0, ease: 'power1.out' }, 0);
    },
    onLeave:     () => { running = false; gsap.ticker.remove(tick); },
    onEnterBack: () => { running = true;  gsap.ticker.add(tick);    },
    onLeaveBack: () => { running = false; gsap.ticker.remove(tick); },
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
  await Promise.all(found.map(({ el, svg }) => initCanvas(el as HTMLElement, svg)));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
} else {
  init().catch(console.error);
}
