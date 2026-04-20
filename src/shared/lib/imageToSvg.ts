import { optimize } from 'svgo';
import type { ImagePadding } from '../../entities/image/model/types';

const TARGET_WIDTH = 178;
const TARGET_HEIGHT = 82;
const TARGET_COLOR = '#565B63';

export function getDefaultPadding(_w: number, _h: number): ImagePadding {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function getImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
      file.text().then((text) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');
        const svg = doc.documentElement;
        const w = parseFloat(svg.getAttribute('width') || '0') ||
          parseFloat((svg.getAttribute('viewBox') || '').split(/\s+/)[2] || '0') || 100;
        const h = parseFloat(svg.getAttribute('height') || '0') ||
          parseFloat((svg.getAttribute('viewBox') || '').split(/\s+/)[3] || '0') || 100;
        resolve({ w, h });
      });
    } else {
      const img = new Image();
      img.onload = () => {
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        resolve({ w: 100, h: 100 });
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    }
  });
}

function svgStringToMonochrome(svgText: string, pad: ImagePadding): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;

  const origW = parseFloat(svg.getAttribute('width') || '0') ||
    parseFloat((svg.getAttribute('viewBox') || '').split(/\s+/)[2] || '0') || 100;
  const origH = parseFloat(svg.getAttribute('height') || '0') ||
    parseFloat((svg.getAttribute('viewBox') || '').split(/\s+/)[3] || '0') || 100;

  const innerW = TARGET_WIDTH - pad.left - pad.right;
  const innerH = TARGET_HEIGHT - pad.top - pad.bottom;

  // Fit content preserving aspect ratio
  const scale = Math.min(innerW / origW, innerH / origH);
  const fitW = origW * scale;
  const fitH = origH * scale;
  const offsetX = pad.left + (innerW - fitW) / 2;
  const offsetY = pad.top + (innerH - fitH) / 2;

  if (!svg.getAttribute('viewBox')) {
    svg.setAttribute('viewBox', `0 0 ${origW} ${origH}`);
  }

  svg.setAttribute('width', `${fitW}`);
  svg.setAttribute('height', `${fitH}`);
  svg.setAttribute('x', `${offsetX}`);
  svg.setAttribute('y', `${offsetY}`);

  // Only recolor visible elements — skip defs, clipPath, mask internals
  const skipTags = new Set(['defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter']);

  function isInsideSkipped(el: Element): boolean {
    let node: Element | null = el.parentElement;
    while (node && node !== svg) {
      if (skipTags.has(node.tagName.toLowerCase())) return true;
      node = node.parentElement;
    }
    return false;
  }

  const allElements = svg.querySelectorAll('*');
  allElements.forEach((el) => {
    if (skipTags.has(el.tagName.toLowerCase()) || isInsideSkipped(el)) return;

    const fill = el.getAttribute('fill');
    if (fill && fill !== 'none' && fill !== 'transparent') {
      el.setAttribute('fill', TARGET_COLOR);
    }
    const stroke = el.getAttribute('stroke');
    if (stroke && stroke !== 'none' && stroke !== 'transparent') {
      el.setAttribute('stroke', TARGET_COLOR);
    }
    const style = el.getAttribute('style');
    if (style) {
      const newStyle = style
        .replace(/fill\s*:\s*(?!none|transparent)[^;]+/gi, `fill: ${TARGET_COLOR}`)
        .replace(/stroke\s*:\s*(?!none|transparent)[^;]+/gi, `stroke: ${TARGET_COLOR}`);
      el.setAttribute('style', newStyle);
    }
  });

  // Add fill to visible content only if no explicit fills found
  const hasVisibleFill = Array.from(allElements).some(
    (el) => !skipTags.has(el.tagName.toLowerCase()) && !isInsideSkipped(el) && el.getAttribute('fill')
  );
  if (!hasVisibleFill) {
    svg.setAttribute('fill', TARGET_COLOR);
  }

  const innerSvgString = new XMLSerializer().serializeToString(svg);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET_WIDTH}px" height="${TARGET_HEIGHT}px" viewBox="0 0 ${TARGET_WIDTH} ${TARGET_HEIGHT}">${innerSvgString}</svg>`;
}

function rasterToSvg(
  imageUrl: string,
  pad: ImagePadding,
  intrinsicSize?: { w: number; h: number },
  superSample = 1,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const innerW = TARGET_WIDTH - pad.left - pad.right;
      const innerH = TARGET_HEIGHT - pad.top - pad.bottom;

      const srcW = intrinsicSize?.w || img.naturalWidth;
      const srcH = intrinsicSize?.h || img.naturalHeight;

      // Fit preserving aspect ratio (in target SVG units)
      const fitScale = Math.min(innerW / srcW, innerH / srcH);
      const fitW = srcW * fitScale;
      const fitH = srcH * fitScale;
      const offsetX = pad.left + (innerW - fitW) / 2;
      const offsetY = pad.top + (innerH - fitH) / 2;

      // Render at higher resolution; each output rect spans 1/superSample SVG units
      const canvasW = Math.max(1, Math.round(fitW * superSample));
      const canvasH = Math.max(1, Math.round(fitH * superSample));
      const unit = 1 / superSample;

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(img, 0, 0, canvasW, canvasH);

      const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
      const { data, width, height } = imageData;

      const rects: string[] = [];
      const visited = new Uint8Array(width * height);
      const ALPHA_THRESHOLD = 128;

      const fmt = (n: number) => {
        const r = Math.round(n * 1000) / 1000;
        return Number.isInteger(r) ? `${r}` : `${r}`;
      };

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const alpha = data[idx * 4 + 3];
          if (alpha < ALPHA_THRESHOLD || visited[idx]) continue;

          let runEnd = x;
          while (
            runEnd < width &&
            data[(y * width + runEnd) * 4 + 3] >= ALPHA_THRESHOLD &&
            !visited[y * width + runEnd]
          ) {
            runEnd++;
          }

          let rowEnd = y + 1;
          outer: while (rowEnd < height) {
            for (let rx = x; rx < runEnd; rx++) {
              const rIdx = rowEnd * width + rx;
              if (data[rIdx * 4 + 3] < ALPHA_THRESHOLD || visited[rIdx]) break outer;
            }
            rowEnd++;
          }

          for (let ry = y; ry < rowEnd; ry++) {
            for (let rx = x; rx < runEnd; rx++) {
              visited[ry * width + rx] = 1;
            }
          }

          const rx = offsetX + x * unit;
          const ry = offsetY + y * unit;
          const rw = (runEnd - x) * unit;
          const rh = (rowEnd - y) * unit;
          rects.push(`<rect x="${fmt(rx)}" y="${fmt(ry)}" width="${fmt(rw)}" height="${fmt(rh)}"/>`);
        }
      }

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET_WIDTH}px" height="${TARGET_HEIGHT}px" viewBox="0 0 ${TARGET_WIDTH} ${TARGET_HEIGHT}" fill="${TARGET_COLOR}">\n${rects.join('\n')}\n</svg>`;
      resolve(svg);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

function minifySvg(svgString: string): string {
  const result = optimize(svgString, {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            removeViewBox: false,
          },
        },
      } as never,
      'removeXMLNS',
      'sortAttrs',
    ],
  });
  // Re-add xmlns since we stripped it for minification passes but need it in final output
  return result.data.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

function svgHasEmbeddedRaster(svgText: string): boolean {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const images = doc.documentElement.getElementsByTagName('image');
  for (let i = 0; i < images.length; i++) {
    const href =
      images[i].getAttribute('href') ||
      images[i].getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      '';
    if (/^data:image\/[^;]+;base64,/i.test(href)) return true;
  }
  return false;
}

function getSvgIntrinsicSize(svgText: string): { w: number; h: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = (svg.getAttribute('viewBox') || '').split(/\s+/);
  const w = parseFloat(svg.getAttribute('width') || '0') || parseFloat(vb[2] || '0') || 100;
  const h = parseFloat(svg.getAttribute('height') || '0') || parseFloat(vb[3] || '0') || 100;
  return { w, h };
}

export async function convertToSvg(file: File, padding: ImagePadding): Promise<string> {
  let raw: string;

  if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
    const text = await file.text();
    if (svgHasEmbeddedRaster(text)) {
      const blob = new Blob([text], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        raw = await rasterToSvg(url, padding, getSvgIntrinsicSize(text), 8);
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      raw = svgStringToMonochrome(text, padding);
    }
  } else {
    const url = URL.createObjectURL(file);
    try {
      raw = await rasterToSvg(url, padding);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return minifySvg(raw);
}
