import { useState, useCallback } from 'react';
import type { ConvertedImage, ImagePadding } from '../../../entities/image/model/types';
import { convertToSvg, getImageDimensions, getDefaultPadding } from '../../../shared/lib/imageToSvg';

let counter = 0;

function runConversion(
  id: string,
  file: File,
  padding: ImagePadding,
  setImages: React.Dispatch<React.SetStateAction<ConvertedImage[]>>,
) {
  setImages((prev) =>
    prev.map((i) => (i.id === id ? { ...i, status: 'converting' as const } : i))
  );

  convertToSvg(file, padding)
    .then((svgString) => {
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const blobUrl = URL.createObjectURL(blob);
      setImages((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: 'done' as const,
                svgString,
                svgBlobUrl: blobUrl,
                svgSize: blob.size,
              }
            : i
        )
      );
    })
    .catch((err) => {
      setImages((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: 'error' as const, error: String(err) } : i
        )
      );
    });
}

export function useImageConverter() {
  const [images, setImages] = useState<ConvertedImage[]>([]);

  const addFiles = useCallback((files: File[]) => {
    const accepted = files.filter((f) =>
      /\.(svg|png|jpe?g|webp)$/i.test(f.name)
    );

    accepted.forEach(async (file) => {
      const id = `${++counter}-${file.name}`;
      const dims = await getImageDimensions(file);
      const padding = getDefaultPadding(dims.w, dims.h);

      const baseName = file.name.replace(/\.[^.]+$/, '');

      const newImage: ConvertedImage = {
        id,
        originalFile: file,
        originalUrl: URL.createObjectURL(file),
        svgString: null,
        svgBlobUrl: null,
        svgSize: 0,
        padding,
        downloadName: baseName,
        status: 'pending',
      };

      setImages((prev) => [...prev, newImage]);
      runConversion(id, file, padding, setImages);
    });
  }, []);

  const updatePadding = useCallback((id: string, padding: ImagePadding) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (!img) return prev;

      // Revoke old blob
      if (img.svgBlobUrl) URL.revokeObjectURL(img.svgBlobUrl);

      const updated = prev.map((i) =>
        i.id === id
          ? { ...i, padding, svgBlobUrl: null, svgString: null, svgSize: 0, status: 'pending' as const }
          : i
      );

      // Trigger reconversion
      runConversion(id, img.originalFile, padding, setImages);

      return updated;
    });
  }, []);

  const rename = useCallback((id: string, downloadName: string) => {
    setImages((prev) =>
      prev.map((i) => (i.id === id ? { ...i, downloadName } : i))
    );
  }, []);

  const remove = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) {
        URL.revokeObjectURL(img.originalUrl);
        if (img.svgBlobUrl) URL.revokeObjectURL(img.svgBlobUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setImages((prev) => {
      prev.forEach((img) => {
        URL.revokeObjectURL(img.originalUrl);
        if (img.svgBlobUrl) URL.revokeObjectURL(img.svgBlobUrl);
      });
      return [];
    });
  }, []);

  return { images, addFiles, updatePadding, rename, remove, clearAll };
}
