import { optimize } from 'svgo';
import type { ImagePadding, FillMethod } from '../../entities/image/model/types';

const TARGET_WIDTH = 178;
const TARGET_HEIGHT = 82;
const TARGET_COLOR = '#565B63';
const TWO_TONE_OPACITY = 0.15;

const SKIP_TAGS = new Set([
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'linearGradient',
  'radialGradient',
  'filter',
]);

const SHAPE_TAGS = new Set([
  'rect',
  'path',
  'polygon',
  'polyline',
  'circle',
  'ellipse',
  'line',
  'use',
  'image',
]);

let maskIdCounter = 0;

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

function isInsideSkipped(el: Element, root: Element): boolean {
  let node: Element | null = el.parentElement;
  while (node && node !== root) {
    if (SKIP_TAGS.has(node.tagName.toLowerCase())) return true;
    node = node.parentElement;
  }
  return false;
}

function isVisibleCandidate(el: Element, root: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return false;
  if (isInsideSkipped(el, root)) return false;
  return true;
}

function findBackgroundEl(svg: Element): Element | null {
  const all = svg.querySelectorAll('*');
  for (const el of Array.from(all)) {
    if (!isVisibleCandidate(el, svg)) continue;
    if (SHAPE_TAGS.has(el.tagName.toLowerCase())) return el;
  }
  return null;
}

function recolorElement(el: Element, fillColor: string | null, strokeColor: string | null) {
  const fill = el.getAttribute('fill');
  if (fillColor && fill && fill !== 'none' && fill !== 'transparent') {
    el.setAttribute('fill', fillColor);
  }
  const stroke = el.getAttribute('stroke');
  if (strokeColor && stroke && stroke !== 'none' && stroke !== 'transparent') {
    el.setAttribute('stroke', strokeColor);
  }
  const style = el.getAttribute('style');
  if (style) {
    let newStyle = style;
    if (fillColor) {
      newStyle = newStyle.replace(
        /fill\s*:\s*(?!none|transparent)[^;]+/gi,
        `fill: ${fillColor}`,
      );
    }
    if (strokeColor) {
      newStyle = newStyle.replace(
        /stroke\s*:\s*(?!none|transparent)[^;]+/gi,
        `stroke: ${strokeColor}`,
      );
    }
    el.setAttribute('style', newStyle);
  }
}

function recolorAll(svg: Element, fillColor: string | null, strokeColor: string | null) {
  svg.querySelectorAll('*').forEach((el) => {
    if (!isVisibleCandidate(el, svg)) return;
    recolorElement(el, fillColor, strokeColor);
  });
}

function forcePaint(el: Element, fillColor: string, strokeColor: string | null) {
  el.setAttribute('fill', fillColor);
  if (strokeColor && el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none') {
    el.setAttribute('stroke', strokeColor);
  }
  const style = el.getAttribute('style');
  if (style) {
    let newStyle = style.replace(/fill\s*:\s*[^;]+/gi, `fill: ${fillColor}`);
    if (strokeColor) {
      newStyle = newStyle.replace(/stroke\s*:\s*(?!none)[^;]+/gi, `stroke: ${strokeColor}`);
    }
    el.setAttribute('style', newStyle);
  }
}

function fitSvg(svg: Element, pad: ImagePadding): { origW: number; origH: number } {
  const origW = parseFloat(svg.getAttribute('width') || '0') ||
    parseFloat((svg.getAttribute('viewBox') || '').split(/\s+/)[2] || '0') || 100;
  const origH = parseFloat(svg.getAttribute('height') || '0') ||
    parseFloat((svg.getAttribute('viewBox') || '').split(/\s+/)[3] || '0') || 100;

  const innerW = TARGET_WIDTH - pad.left - pad.right;
  const innerH = TARGET_HEIGHT - pad.top - pad.bottom;

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

  return { origW, origH };
}

function wrapInOuter(innerSvgString: string, extraDefs = '', gAttrs = ''): string {
  const defs = extraDefs ? `<defs>${extraDefs}</defs>` : '';
  const body = gAttrs ? `<g ${gAttrs}>${innerSvgString}</g>` : innerSvgString;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET_WIDTH}px" height="${TARGET_HEIGHT}px" viewBox="0 0 ${TARGET_WIDTH} ${TARGET_HEIGHT}">${defs}${body}</svg>`;
}

function applyDefault(svg: Element): string {
  recolorAll(svg, TARGET_COLOR, TARGET_COLOR);

  const hasVisibleFill = Array.from(svg.querySelectorAll('*')).some(
    (el) => isVisibleCandidate(el, svg) && el.getAttribute('fill'),
  );
  if (!hasVisibleFill) {
    svg.setAttribute('fill', TARGET_COLOR);
  }
  return new XMLSerializer().serializeToString(svg);
}

function applyForeground(svg: Element): string {
  const bg = findBackgroundEl(svg);
  if (bg && bg.parentElement) {
    bg.parentElement.removeChild(bg);
  }
  return applyDefault(svg);
}

function applyTwoTone(svg: Element): string {
  const bg = findBackgroundEl(svg);
  recolorAll(svg, TARGET_COLOR, TARGET_COLOR);

  const hasVisibleFill = Array.from(svg.querySelectorAll('*')).some(
    (el) => isVisibleCandidate(el, svg) && el.getAttribute('fill'),
  );
  if (!hasVisibleFill) {
    svg.setAttribute('fill', TARGET_COLOR);
  }

  if (bg) {
    forcePaint(bg, TARGET_COLOR, bg.getAttribute('stroke') ? TARGET_COLOR : null);
    bg.setAttribute('fill-opacity', String(TWO_TONE_OPACITY));
    if (bg.getAttribute('stroke') && bg.getAttribute('stroke') !== 'none') {
      bg.setAttribute('stroke-opacity', String(TWO_TONE_OPACITY));
    }
  }
  return new XMLSerializer().serializeToString(svg);
}

function applyCutout(svg: Element): { inner: string; defs: string; gAttrs: string } | null {
  const bg = findBackgroundEl(svg);
  if (!bg) return null;

  const BG_MARKER = 'data-fill-bg-role';
  bg.setAttribute(BG_MARKER, '1');

  const maskSvg = svg.cloneNode(true) as Element;

  maskSvg.querySelectorAll('*').forEach((el) => {
    if (!isVisibleCandidate(el, maskSvg)) return;
    forcePaint(el, 'black', el.getAttribute('stroke') ? 'black' : null);
  });
  const bgInMask = maskSvg.querySelector(`[${BG_MARKER}]`);
  if (bgInMask) {
    forcePaint(bgInMask, 'white', bgInMask.getAttribute('stroke') ? 'white' : null);
    bgInMask.removeAttribute(BG_MARKER);
  }

  bg.removeAttribute(BG_MARKER);

  recolorAll(svg, TARGET_COLOR, TARGET_COLOR);
  const hasVisibleFill = Array.from(svg.querySelectorAll('*')).some(
    (el) => isVisibleCandidate(el, svg) && el.getAttribute('fill'),
  );
  if (!hasVisibleFill) {
    svg.setAttribute('fill', TARGET_COLOR);
  }

  const maskId = `cutout-${++maskIdCounter}`;
  const serializer = new XMLSerializer();
  const maskContent = serializer.serializeToString(maskSvg);
  const paintedInner = serializer.serializeToString(svg);

  const maskEl = `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}"><rect x="0" y="0" width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}" fill="black"/>${maskContent}</mask>`;

  return { inner: paintedInner, defs: maskEl, gAttrs: `mask="url(#${maskId})"` };
}

function svgStringToMonochrome(svgText: string, pad: ImagePadding, fillMethod: FillMethod): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;

  fitSvg(svg, pad);

  if (fillMethod === 'cutout') {
    const result = applyCutout(svg);
    if (result) {
      return wrapInOuter(result.inner, result.defs, result.gAttrs);
    }
    // Fallback: no background detected, behave like default
  }

  let inner: string;
  if (fillMethod === 'foreground') {
    inner = applyForeground(svg);
  } else if (fillMethod === 'two-tone') {
    inner = applyTwoTone(svg);
  } else {
    inner = applyDefault(svg);
  }
  return wrapInOuter(inner);
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

      const fitScale = Math.min(innerW / srcW, innerH / srcH);
      const fitW = srcW * fitScale;
      const fitH = srcH * fitScale;
      const offsetX = pad.left + (innerW - fitW) / 2;
      const offsetY = pad.top + (innerH - fitH) / 2;

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

export async function isSvgVector(file: File): Promise<boolean> {
  const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');
  if (!isSvg) return false;
  const text = await file.text();
  return !svgHasEmbeddedRaster(text);
}

export async function convertToSvg(
  file: File,
  padding: ImagePadding,
  fillMethod: FillMethod = 'default',
): Promise<string> {
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
      raw = svgStringToMonochrome(text, padding, fillMethod);
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
