import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { ConvertedImage } from '../../../entities/image/model/types';

export function svgToWebpBlob(svgString: string, scale: number = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create WebP blob'));
        },
        'image/webp',
        0.95,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG to image'));
    };
    img.src = url;
  });
}

export function downloadSingle(image: ConvertedImage) {
  if (!image.svgString) return;
  const blob = new Blob([image.svgString], { type: 'image/svg+xml' });
  saveAs(blob, image.downloadName + '.svg');
}

export async function downloadSingleWebp(image: ConvertedImage, scale: number = 1) {
  if (!image.svgString) return;
  const blob = await svgToWebpBlob(image.svgString, scale);
  saveAs(blob, image.downloadName + '.webp');
}

export async function downloadAll(images: ConvertedImage[]) {
  const done = images.filter((i) => i.status === 'done' && i.svgString);
  if (done.length === 0) return;

  const zip = new JSZip();
  done.forEach((img) => {
    zip.file(img.downloadName + '.svg', img.svgString!);
  });

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'converted-svgs.zip');
}

export async function downloadAllWebp(images: ConvertedImage[], scale: number = 1) {
  const done = images.filter((i) => i.status === 'done' && i.svgString);
  if (done.length === 0) return;

  const zip = new JSZip();
  for (const img of done) {
    const blob = await svgToWebpBlob(img.svgString!, scale);
    zip.file(img.downloadName + '.webp', blob);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'converted-webps.zip');
}
