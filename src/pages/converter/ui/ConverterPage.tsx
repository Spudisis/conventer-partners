import { useState } from 'react';
import { DropZone } from '../../../features/convert-image/ui/DropZone';
import { ImageCard } from '../../../entities/image/ui/ImageCard';
import { useImageConverter } from '../../../features/convert-image/lib/useImageConverter';
import {
  downloadSingle,
  downloadSingleWebp,
  downloadAll,
  downloadAllWebp,
} from '../../../features/convert-image/lib/downloadHelpers';
import styles from './ConverterPage.module.css';

export type ExportFormat = 'svg' | 'webp';

const RETINA_OPTIONS = [1, 1.5, 2, 3, 4];

export function ConverterPage() {
  const { images, addFiles, updatePadding, rename, remove, clearAll } = useImageConverter();
  const doneCount = images.filter((i) => i.status === 'done').length;
  const [format, setFormat] = useState<ExportFormat>('webp');
  const [retinaScale, setRetinaScale] = useState(1);

  const handleDownload = (image: Parameters<typeof downloadSingle>[0]) => {
    if (format === 'svg') downloadSingle(image);
    else downloadSingleWebp(image, retinaScale);
  };

  const handleDownloadAll = () => {
    if (format === 'svg') downloadAll(images);
    else downloadAllWebp(images, retinaScale);
  };

  return (
    <DropZone onFiles={addFiles}>
      <header className={styles.header}>
        <h1 className={styles.title}>SVG Converter</h1>
        <p className={styles.subtitle}>
          Drop images anywhere or click "Select Files" to convert to SVG
          <br />
          <span className={styles.meta}>
            Color: <strong>#565B63</strong> &middot; Size: <strong>178×82 px</strong>
          </span>
        </p>
      </header>

      {images.length > 0 && (
        <div className={styles.toolbar}>
          <span className={styles.count}>
            {doneCount} / {images.length} converted
          </span>
          <div className={styles.toolbarActions}>
            <div className={styles.formatGroup}>
              <button
                className={`${styles.formatBtn} ${format === 'svg' ? styles.formatBtnActive : ''}`}
                onClick={() => setFormat('svg')}
              >
                SVG
              </button>
              <button
                className={`${styles.formatBtn} ${format === 'webp' ? styles.formatBtnActive : ''}`}
                onClick={() => setFormat('webp')}
              >
                WebP
              </button>
            </div>
            {format === 'webp' && (
              <div className={styles.retinaGroup}>
                <span className={styles.retinaLabel}>Retina</span>
                {RETINA_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.retinaBtn} ${retinaScale === s ? styles.retinaBtnActive : ''}`}
                    onClick={() => setRetinaScale(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
            {doneCount > 1 && (
              <button className={styles.actionBtn} onClick={handleDownloadAll}>
                All {format.toUpperCase()} (.zip)
              </button>
            )}
            <button className={styles.clearBtn} onClick={clearAll}>
              Clear All
            </button>
          </div>
        </div>
      )}

      {images.length === 0 && (
        <div className={styles.empty}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#c4c7cc" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <p>SVG, PNG, JPEG, WEBP</p>
        </div>
      )}

      <div className={styles.grid}>
        {images.map((img) => (
          <ImageCard
            key={img.id}
            image={img}
            format={format}
            retinaScale={retinaScale}
            onDownload={handleDownload}
            onPaddingChange={updatePadding}
            onRename={rename}
            onRemove={remove}
          />
        ))}
      </div>
    </DropZone>
  );
}
