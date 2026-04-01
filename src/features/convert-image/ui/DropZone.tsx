import { useCallback, useRef, useState, useEffect } from 'react';
import styles from './DropZone.module.css';

interface Props {
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
}

export function DropZone({ onFiles, children }: Props) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      dragCounter.current = 0;
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        onFiles(Array.from(e.dataTransfer.files));
      }
    },
    [onFiles]
  );

  useEffect(() => {
    window.addEventListener('dragenter', handleDragIn);
    window.addEventListener('dragleave', handleDragOut);
    window.addEventListener('dragover', handleDrag);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragIn);
      window.removeEventListener('dragleave', handleDragOut);
      window.removeEventListener('dragover', handleDrag);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDrag, handleDragIn, handleDragOut, handleDrop]);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  return (
    <div className={styles.wrapper}>
      {dragging && (
        <div className={styles.overlay}>
          <div className={styles.overlayContent}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#565B63" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <p>Drop images here</p>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".svg,.png,.jpg,.jpeg,.webp"
        onChange={handleInputChange}
        className={styles.hiddenInput}
      />
      <div className={styles.content}>
        {children}
        <button className={styles.selectBtn} onClick={handleFileSelect}>
          Select Files
        </button>
      </div>
    </div>
  );
}
