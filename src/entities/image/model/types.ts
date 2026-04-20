export interface ImagePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type FillMethod = 'default' | 'cutout' | 'foreground' | 'two-tone';

export interface ConvertedImage {
  id: string;
  originalFile: File;
  originalUrl: string;
  svgString: string | null;
  svgBlobUrl: string | null;
  svgSize: number;
  padding: ImagePadding;
  fillMethod: FillMethod;
  isVectorSvg: boolean;
  downloadName: string;
  status: 'pending' | 'converting' | 'done' | 'error';
  error?: string;
}
