// Browser-side entry point for the CLI (scripts/convert.mjs).
//
// The conversion pipeline is built on browser APIs — canvas pixel work,
// DOMParser/XMLSerializer, canvas.toDataURL/toBlob for the WebP export — so the
// CLI runs this bundle inside a headless Chromium page instead of reimplementing
// any of it in Node. That keeps script output byte-identical to what the UI
// produces: the same functions, the same defaults, the same engine.

import type { FillMethod, ImagePadding } from '../../src/entities/image/model/types';
import { computeAutoPadding, convertToSvg, isSvgVector } from '../../src/shared/lib/imageToSvg';
import { svgToWebpBlob } from '../../src/features/convert-image/lib/downloadHelpers';

export interface ConvertRequest {
  name: string;
  mime: string;
  /** Source file bytes, base64 — the only shape that survives the CDP hop. */
  base64: string;
  fill: FillMethod;
  /** 'auto' reproduces the padding the UI suggests on drop. */
  padding: ImagePadding | 'auto';
  /** null skips the WebP render entirely. */
  webpScale: number | null;
}

export interface ConvertResult {
  svg: string;
  webpBase64: string | null;
  padding: ImagePadding;
  isVectorSvg: boolean;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  // Back it with a plain ArrayBuffer so the bytes are a valid BlobPart.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function convert(req: ConvertRequest): Promise<ConvertResult> {
  const file = new File([base64ToBytes(req.base64)], req.name, { type: req.mime });

  const [isVectorSvg, padding] = await Promise.all([
    isSvgVector(file),
    req.padding === 'auto' ? computeAutoPadding(file) : Promise.resolve(req.padding),
  ]);

  const svg = await convertToSvg(file, padding, req.fill);
  const webpBase64 = req.webpScale
    ? await blobToBase64(await svgToWebpBlob(svg, req.webpScale))
    : null;

  return { svg, webpBase64, padding, isVectorSvg };
}

declare global {
  interface Window {
    __converter?: { convert: (req: ConvertRequest) => Promise<ConvertResult> };
  }
}

window.__converter = { convert };
