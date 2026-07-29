import { useState, useRef, useEffect } from 'react';
import type { ConvertedImage, FillMethod, ImagePadding } from '../model/types';
import type { ExportFormat } from '../../../pages/converter/ui/ConverterPage';
import { svgToWebpBlob } from '../../../features/convert-image/lib/downloadHelpers';
import { formatSize } from '../../../shared/lib/formatSize';
import styles from './ImageCard.module.css';

interface PaddingPreset {
  label: string;
  padding: ImagePadding;
}

const PRESETS: PaddingPreset[] = [
  { label: 'None',               padding: { top: 0,  right: 0,  bottom: 0,  left: 0  } },
  { label: 'T:10 B:10',          padding: { top: 10, right: 0,  bottom: 10, left: 0  } },
  { label: 'L:15 R:15',          padding: { top: 0,  right: 15, bottom: 0,  left: 15 } },
  { label: 'T:15 B:15',          padding: { top: 15, right: 0,  bottom: 15, left: 0  } },
  { label: 'T:10 R:10 B:10 L:10', padding: { top: 10, right: 10, bottom: 10, left: 10 } },
  { label: 'T:5 R:15 B:5 L:15',  padding: { top: 5,  right: 15, bottom: 5,  left: 15 } },
];

const FILL_METHODS: { value: FillMethod; label: string }[] = [
  { value: 'default',    label: 'Default' },
  { value: 'cutout',     label: 'Cutout' },
  { value: 'foreground', label: 'Foreground' },
  { value: 'two-tone',   label: 'Two-tone' },
];

function padMatch(a: ImagePadding, b: ImagePadding) {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

interface Props {
  image: ConvertedImage;
  format: ExportFormat;
  retinaScale: number;
  onDownload: (image: ConvertedImage) => void;
  onPaddingChange: (id: string, padding: ImagePadding) => void;
  onFillMethodChange: (id: string, method: FillMethod) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

function padToStrings(p: ImagePadding): Record<keyof ImagePadding, string> {
  return { top: String(p.top), right: String(p.right), bottom: String(p.bottom), left: String(p.left) };
}

export function ImageCard({ image, format, retinaScale, onDownload, onPaddingChange, onFillMethodChange, onRename, onRemove }: Props) {
  const originalSize = formatSize(image.originalFile.size);

  const [localPad, setLocalPad] = useState(image.padding);
  const [padRaw, setPadRaw] = useState(() => padToStrings(image.padding));
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(image.downloadName);
  const [webpSize, setWebpSize] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Compute WebP size when format/retina/svgString changes
  useEffect(() => {
    if (format !== 'webp' || !image.svgString || image.status !== 'done') {
      setWebpSize(null);
      return;
    }

    let cancelled = false;
    setWebpSize(null);

    svgToWebpBlob(image.svgString, retinaScale).then((blob) => {
      if (!cancelled) setWebpSize(blob.size);
    }).catch(() => {
      if (!cancelled) setWebpSize(null);
    });

    return () => { cancelled = true; };
  }, [format, retinaScale, image.svgString, image.status]);

  const resultSize = (() => {
    if (image.status !== 'done') return '—';
    if (format === 'svg') return image.svgSize ? formatSize(image.svgSize) : '—';
    return webpSize !== null ? formatSize(webpSize) : '…';
  })();

  const commitName = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== image.downloadName) {
      onRename(image.id, trimmed);
    } else {
      setNameValue(image.downloadName);
    }
    setEditing(false);
  };

  const handleChange = (side: keyof ImagePadding, value: string) => {
    if (!/^-?\d*$/.test(value)) return;
    setPadRaw({ ...padRaw, [side]: value });
    if (value === '' || value === '-') {
      setLocalPad({ ...localPad, [side]: 0 });
      return;
    }
    const parsed = parseInt(value, 10);
    const num = Math.max(-40, Math.min(40, parsed));
    setLocalPad({ ...localPad, [side]: num });
    if (num !== parsed) setPadRaw({ ...padRaw, [side]: String(num) });
  };

  const applyPreset = (preset: PaddingPreset) => {
    setLocalPad(preset.padding);
    setPadRaw(padToStrings(preset.padding));
    onPaddingChange(image.id, preset.padding);
  };

  const applyPadding = () => {
    onPaddingChange(image.id, localPad);
  };

  const padChanged =
    localPad.top !== image.padding.top ||
    localPad.right !== image.padding.right ||
    localPad.bottom !== image.padding.bottom ||
    localPad.left !== image.padding.left;

  return (
    <div className={styles.card}>
      <button className={styles.removeBtn} onClick={() => onRemove(image.id)} title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <div className={styles.preview}>
        <div className={styles.previewItem}>
          <span className={styles.label}>Original</span>
          <div className={styles.imageWrap}>
            <img src={image.originalUrl} alt="original" />
          </div>
          <span className={styles.size}>{originalSize}</span>
        </div>
        <div className={styles.arrow}>→</div>
        <div className={styles.previewItem}>
          <span className={styles.label}>{format.toUpperCase()}</span>
          <div className={styles.imageWrap}>
            {image.status === 'done' && image.svgBlobUrl ? (
              <img src={image.svgBlobUrl} alt="converted" />
            ) : image.status === 'converting' ? (
              <div className={styles.spinner} />
            ) : image.status === 'error' ? (
              <span className={styles.error}>Error</span>
            ) : null}
          </div>
          <span className={styles.size}>{resultSize}</span>
        </div>
      </div>

      <div className={styles.paddingControls}>
        <span className={styles.paddingLabel}>Fill</span>
        <div className={styles.presets}>
          {FILL_METHODS.map((fm) => {
            const isActive = image.fillMethod === fm.value;
            const isCompositeMode = fm.value !== 'default';
            const disabled =
              image.status === 'converting' ||
              isActive ||
              (isCompositeMode && !image.isVectorSvg);
            const title = isCompositeMode && !image.isVectorSvg ? 'only for vector SVG' : undefined;
            return (
              <button
                key={fm.value}
                className={`${styles.presetBadge} ${isActive ? styles.presetActive : ''}`}
                onClick={() => onFillMethodChange(image.id, fm.value)}
                disabled={disabled}
                title={title}
              >
                {fm.label}
              </button>
            );
          })}
        </div>

        <span className={styles.paddingLabel}>Presets</span>
        <div className={styles.presets}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={`${styles.presetBadge} ${padMatch(image.padding, preset.padding) ? styles.presetActive : ''}`}
              onClick={() => applyPreset(preset)}
              disabled={image.status === 'converting' || padMatch(image.padding, preset.padding)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <span className={styles.paddingLabel}>Custom</span>
        <div className={styles.paddingFields}>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className={styles.padField}>
              <span className={styles.padSide}>{side[0].toUpperCase()}</span>
              <input
                type="text"
                inputMode="numeric"
                value={padRaw[side]}
                onChange={(e) => handleChange(side, e.target.value)}
                className={styles.padInput}
              />
            </label>
          ))}
          <button
            className={styles.applyBtn}
            onClick={applyPadding}
            disabled={!padChanged || image.status === 'converting'}
          >
            Apply
          </button>
        </div>
      </div>

      <div className={styles.info}>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.filenameInput}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') { setNameValue(image.downloadName); setEditing(false); }
            }}
          />
        ) : (
          <span
            className={styles.filename}
            onClick={() => setEditing(true)}
            title="Click to rename"
          >
            {image.downloadName}.{format}
          </span>
        )}
        <button
          className={styles.downloadBtn}
          onClick={() => onDownload(image)}
          disabled={image.status !== 'done'}
        >
          {format.toUpperCase()}
        </button>
      </div>
    </div>
  );
}
