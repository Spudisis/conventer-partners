import { DropZone } from '../../../features/convert-image/ui/DropZone';
import { ImageCard } from '../../../entities/image/ui/ImageCard';
import { useImageConverter } from '../../../features/convert-image/lib/useImageConverter';
import {
  downloadSingle,
  downloadAll,
} from '../../../features/convert-image/lib/downloadHelpers';
import styles from './ConverterPage.module.css';

export function ConverterPage() {
  const { images, addFiles, updatePadding, rename, remove, clearAll } = useImageConverter();
  const doneCount = images.filter((i) => i.status === 'done').length;

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
            {doneCount > 1 && (
              <button className={styles.actionBtn} onClick={() => downloadAll(images)}>
                Download All (.zip)
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
          <ImageCard key={img.id} image={img} onDownload={downloadSingle} onPaddingChange={updatePadding} onRename={rename} onRemove={remove} />
        ))}
      </div>
    </DropZone>
  );
}
