export interface ImagePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ConvertedImage {
  id: string;
  originalFile: File;
  originalUrl: string;
  svgString: string | null;
  svgBlobUrl: string | null;
  svgSize: number;
  padding: ImagePadding;
  downloadName: string;
  status: 'pending' | 'converting' | 'done' | 'error';
  error?: string;
}
