export interface ParticleTarget {
  x: number;
  y: number;
}

export interface ParseResult {
  points: ParticleTarget[];
  /** Size of one grid cell in world units (normalised coords) */
  cellSize: number;
}

export async function parseSvgToPoints(
  svgSource: string,
  spacing = 4,
): Promise<ParseResult> {
  let svgText: string;

  if (svgSource.trimStart().startsWith('<')) {
    svgText = svgSource;
  } else {
    const response = await fetch(svgSource);
    svgText = await response.text();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');

  if (!svgEl) {
    throw new Error('Could not parse SVG. Check the source is valid SVG.');
  }

  const vb = svgEl.getAttribute('viewBox')?.split(' ').map(Number);
  const w = vb ? vb[2] : parseInt(svgEl.getAttribute('width') || '400');
  const h = vb ? vb[3] : parseInt(svgEl.getAttribute('height') || '400');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const img = new Image();
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);

  const imageData = ctx.getImageData(0, 0, w, h);
  const points: ParticleTarget[] = [];

  const step = Math.max(1, spacing);

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      const alpha = imageData.data[idx + 3];
      if (alpha > 128) {
        points.push({
          x: (x / w - 0.5),
          y: -(y / h - 0.5),
        });
      }
    }
  }

  const cellSize = step / Math.max(w, h);

  return { points, cellSize };
}
