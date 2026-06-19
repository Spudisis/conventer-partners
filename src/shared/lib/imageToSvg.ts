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

// --- Brand-color recolor -----------------------------------------------------
// The rule is deliberately simple and predictable: the coloured/dark artwork is
// painted the flat brand color, while near-white areas become fully transparent
// — "no colour there". That white isn't just the outer background: it's also the
// white counter of a letter knocked into a coloured tile (the "iD" in IP DEEP),
// and the white gap a logo leaves between a stroke and its keyline. Those read
// as transparent against their colour, so we clear them instead of tinting them
// a light shade. We only knock white out when there's a real coloured/dark
// subject to keep — an all-white logo is painted brand rather than vanishing.

const BRAND_RGB = hexToRgb(TARGET_COLOR);

function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Luminance band for the white knockout: at/under LO a pixel is solid subject,
// at/over HI it's cleared, and the gap between is feathered so cut-out edges
// stay smooth.
const WHITE_KNOCKOUT_LO = 0.78;
const WHITE_KNOCKOUT_HI = 0.92;
// Need at least this share of (opaque) pixels to be non-white before we treat
// white as something to remove rather than as the subject itself.
const WHITE_MIN_SUBJECT = 0.01;

function recolorToBrandPalette(imageData: ImageData): void {
  const { data } = imageData;
  const n = data.length / 4;

  // Is there a coloured/dark subject, or is the artwork essentially all white?
  let opaque = 0, subject = 0;
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] < 200) continue; // ignore anti-aliased edges here
    opaque++;
    if (luma(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) <= WHITE_KNOCKOUT_LO) subject++;
  }
  const knockoutWhite = opaque > 0 && subject / opaque >= WHITE_MIN_SUBJECT;

  const span = WHITE_KNOCKOUT_HI - WHITE_KNOCKOUT_LO;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    if (knockoutWhite) {
      const L = luma(data[i], data[i + 1], data[i + 2]);
      if (L >= WHITE_KNOCKOUT_HI) {
        data[i + 3] = 0; // white area → no colour
        continue;
      }
      if (L > WHITE_KNOCKOUT_LO) {
        data[i + 3] = Math.round(data[i + 3] * (1 - (L - WHITE_KNOCKOUT_LO) / span));
      }
    }
    data[i] = BRAND_RGB[0];
    data[i + 1] = BRAND_RGB[1];
    data[i + 2] = BRAND_RGB[2];
  }
}

// --- Background removal ------------------------------------------------------
// Raster logos often arrive sitting on a solid card/background (a white box, a
// coloured panel, …). We key that background out so the exported asset is
// transparent instead of a filled rectangle. Detection is deliberately
// conservative: a background is only removed when the image border is dominated
// by one uniform, opaque colour. Busy / full-bleed artwork and logos that are
// already transparent are left untouched. Removal is colour-distance based
// (global, not a flood fill from the edge) so the enclosed holes inside letters
// become transparent too, with a feathered band so anti-aliased edges stay soft.

const BG_KEY_LOW = 26; // pixels within this RGB distance of the bg are fully cleared
const BG_KEY_HIGH = 64; // beyond this they are fully kept; the band between is feathered
const BG_BORDER_TOL = 42; // a ring pixel counts as "background-coloured" within this
const BG_BORDER_MATCH = 0.85; // share of opaque ring pixels that must agree on the colour
const BG_BORDER_OPAQUE = 0.5; // share of the ring that must be opaque to bother looking
const BG_MIN_FOREGROUND = 0.004; // need at least this share of content unlike the bg, else
                                 // the "background" IS the subject (a solid icon) — leave it

const ALPHA_OPAQUE = 128;

function colorDist(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function removeBackground(imageData: ImageData): void {
  const { data, width, height } = imageData;
  if (width < 3 || height < 3) return;

  // The artwork rarely fills the whole canvas — exported SVGs clip/inset it, so
  // the real edges are transparent. Find the bounding box of the opaque content
  // (the card/box + logo) and sample the background from inside *that*, not the
  // canvas border.
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= ALPHA_OPAQUE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return; // nothing opaque
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  if (bw < 3 || bh < 3) return;

  // A ring just inside the content box — a couple percent thick, but at least a
  // pixel. A genuine background fills this ring with one uniform colour.
  const ring = Math.max(1, Math.round(Math.min(bw, bh) * 0.04));
  const onRing = (x: number, y: number) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY &&
    (x < minX + ring || x > maxX - ring || y < minY + ring || y > maxY - ring);

  // Average colour of the opaque ring pixels — our background estimate.
  let sumR = 0, sumG = 0, sumB = 0, opaque = 0, total = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!onRing(x, y)) continue;
      total++;
      const i = (y * width + x) * 4;
      if (data[i + 3] < ALPHA_OPAQUE) continue;
      opaque++;
      sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
    }
  }
  if (total === 0 || opaque / total < BG_BORDER_OPAQUE) return; // ring not a solid fill

  const bgR = sumR / opaque, bgG = sumG / opaque, bgB = sumB / opaque;

  // Only proceed if the ring is genuinely uniform (one background colour),
  // otherwise we'd be punching holes in real artwork.
  let match = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!onRing(x, y)) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3] < ALPHA_OPAQUE) continue;
      if (colorDist(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB) <= BG_BORDER_TOL) match++;
    }
  }
  if (match / opaque < BG_BORDER_MATCH) return; // no clear single-colour background

  // Guard: make sure there's an actual subject sitting on this background. If
  // almost every opaque pixel matches the ring colour, the "background" is the
  // whole image (e.g. a solid filled icon) — removing it would erase everything.
  let contentOpaque = 0, foreground = 0;
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] < ALPHA_OPAQUE) continue;
    contentOpaque++;
    if (colorDist(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB) >= BG_KEY_HIGH) foreground++;
  }
  if (contentOpaque === 0 || foreground / contentOpaque < BG_MIN_FOREGROUND) return;

  // Clear the background colour wherever it appears (globally, so the holes
  // inside letters go transparent too), feathering the transition band so the
  // logo's anti-aliased edges don't turn jagged.
  const span = BG_KEY_HIGH - BG_KEY_LOW;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    const d = colorDist(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB);
    if (d <= BG_KEY_LOW) {
      data[i + 3] = 0;
    } else if (d < BG_KEY_HIGH) {
      data[i + 3] = Math.round(data[i + 3] * ((d - BG_KEY_LOW) / span));
    }
  }
}

// Padding auto-added (per side) where content sits flush. The card is much
// shorter than it is wide, so the vertical margin is smaller than the horizontal
// one — otherwise a top/bottom-flush logo gets shrunk too much.
const AUTO_PAD_H = 15;
const AUTO_PAD_V = 7;
// Content within this fraction of the card edge counts as "(almost) flush".
const FLUSH_RATIO = 0.06;

// Inspect a file's actual content (non-transparent pixels) and suggest padding:
// if the content runs (almost) edge-to-edge on an axis once fitted into the
// card, add a comfortable margin on that axis so it doesn't touch the border.
export function computeAutoPadding(file: File): Promise<ImagePadding> {
  const none: ImagePadding = { top: 0, right: 0, bottom: 0, left: 0 };
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const natW = img.naturalWidth || 100;
      const natH = img.naturalHeight || 100;
      const s = Math.min(1, 400 / Math.max(natW, natH)); // cap analysis resolution
      const aw = Math.max(1, Math.round(natW * s));
      const ah = Math.max(1, Math.round(natH * s));

      const canvas = document.createElement('canvas');
      canvas.width = aw;
      canvas.height = ah;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, aw, ah);
      URL.revokeObjectURL(url);

      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, aw, ah).data;
      } catch {
        resolve(none);
        return;
      }

      // Tight bounding box of visible pixels.
      let minX = aw, minY = ah, maxX = -1, maxY = -1;
      for (let y = 0; y < ah; y++) {
        for (let x = 0; x < aw; x++) {
          if (data[(y * aw + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) {
        resolve(none); // fully transparent
        return;
      }

      // Fit the frame (same aspect as the source) into the card, then measure
      // the gap between the content and each card edge.
      const scale = Math.min(TARGET_WIDTH / aw, TARGET_HEIGHT / ah);
      const offX = (TARGET_WIDTH - aw * scale) / 2;
      const offY = (TARGET_HEIGHT - ah * scale) / 2;
      const gapLeft = offX + minX * scale;
      const gapRight = TARGET_WIDTH - (offX + (maxX + 1) * scale);
      const gapTop = offY + minY * scale;
      const gapBottom = TARGET_HEIGHT - (offY + (maxY + 1) * scale);

      const hThresh = TARGET_WIDTH * FLUSH_RATIO;
      const vThresh = TARGET_HEIGHT * FLUSH_RATIO;
      const pad: ImagePadding = { top: 0, right: 0, bottom: 0, left: 0 };
      if (gapLeft < hThresh && gapRight < hThresh) {
        pad.left = AUTO_PAD_H;
        pad.right = AUTO_PAD_H;
      }
      if (gapTop < vThresh && gapBottom < vThresh) {
        pad.top = AUTO_PAD_V;
        pad.bottom = AUTO_PAD_V;
      }
      resolve(pad);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(none);
    };
    img.src = url;
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

function fmt(n: number): string {
  return `${Math.round(n * 1000) / 1000}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// At least this many rendered pixels per fitted user-unit — matches a 4x retina
// WebP export, so even small sources stay crisp.
const MIN_RENDER_SCALE = 4;
// Hard cap on the rendered raster's longest edge, to bound memory.
const MAX_RENDER_DIM = 2400;

function rasterToMonochromeSvg(
  imageUrl: string,
  pad: ImagePadding,
  intrinsicSize?: { w: number; h: number },
  nativePx?: { w: number; h: number },
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

      // Render at the source's own resolution where we can: an SVG that embeds a
      // 1383px raster shouldn't be squashed to 712px just because it's fitted
      // into a small box. Take the larger of the retina floor and the source's
      // native pixel density, capped so we never blow up memory.
      const nativeW = nativePx?.w || img.naturalWidth || fitW;
      const nativeH = nativePx?.h || img.naturalHeight || fitH;
      const nativeScale = Math.max(nativeW / fitW, nativeH / fitH);
      const renderScale = Math.min(
        Math.max(MIN_RENDER_SCALE, nativeScale),
        MAX_RENDER_DIM / Math.max(fitW, fitH),
      );

      const canvasW = Math.max(1, Math.round(fitW * renderScale));
      const canvasH = Math.max(1, Math.round(fitH * renderScale));

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(img, 0, 0, canvasW, canvasH);

      // Drop a solid background (white card, coloured panel, …) so the export is
      // transparent, then recolor what remains to the brand palette, keeping
      // alpha so edges stay smooth.
      const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
      removeBackground(imageData);
      recolorToBrandPalette(imageData);
      ctx.putImageData(imageData, 0, 0);

      const dataUrl = canvas.toDataURL('image/png');
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET_WIDTH}px" height="${TARGET_HEIGHT}px" viewBox="0 0 ${TARGET_WIDTH} ${TARGET_HEIGHT}">` +
        `<image x="${fmt(offsetX)}" y="${fmt(offsetY)}" width="${fmt(fitW)}" height="${fmt(fitH)}" preserveAspectRatio="none" href="${dataUrl}"/>` +
        `</svg>`;
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

// The largest embedded raster's native pixel size — its real resolution, which
// is what we should render at rather than the SVG's (much smaller) layout size.
function getSvgRasterPixelSize(svgText: string): { w: number; h: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const images = doc.documentElement.getElementsByTagName('image');
  let w = 0, h = 0;
  for (let i = 0; i < images.length; i++) {
    const href =
      images[i].getAttribute('href') ||
      images[i].getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      '';
    if (!/^data:image\/[^;]+;base64,/i.test(href)) continue;
    const iw = parseFloat(images[i].getAttribute('width') || '0');
    const ih = parseFloat(images[i].getAttribute('height') || '0');
    if (iw > w) w = iw;
    if (ih > h) h = ih;
  }
  return w > 0 && h > 0 ? { w, h } : null;
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
  if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
    const text = await file.text();
    if (svgHasEmbeddedRaster(text)) {
      const blob = new Blob([text], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        // Bulk is a base64 raster — SVGO can't shrink it, so skip minify.
        return await rasterToMonochromeSvg(
          url,
          padding,
          getSvgIntrinsicSize(text),
          getSvgRasterPixelSize(text) ?? undefined,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return minifySvg(svgStringToMonochrome(text, padding, fillMethod));
  }

  const url = URL.createObjectURL(file);
  try {
    return await rasterToMonochromeSvg(url, padding);
  } finally {
    URL.revokeObjectURL(url);
  }
}
