import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { ConvertedImage } from '../../../entities/image/model/types';

export function downloadSingle(image: ConvertedImage) {
  if (!image.svgString) return;
  const blob = new Blob([image.svgString], { type: 'image/svg+xml' });
  saveAs(blob, image.downloadName + '.svg');
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
