export interface Camera {
  cameraId: string;
  name: string;
  municipality: string;
  lat: number;
  lon: number;
  latestCaptureEpoch: number;
}

export interface Detection {
  bbox: [number, number, number, number];
  label: string;
  score: number;
}

export interface DetectionSummary {
  cameraId: string;
  capturedAtEpoch: number;
  capturedAt: string;
  hasWildlife: boolean;
  hasPerson: boolean;
  detectionCount: number;
  detectedClasses: string[];
  processingStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  rawImageKey: string;
  processedImageKey: string | null;
}

export interface ListCamerasResponse {
  cameras: Camera[];
}

export interface ListDetectionsResponse {
  items: DetectionSummary[];
  nextToken?: string;
  count: number;
}

export interface GetImageUrlResponse {
  url: string;
  expiresIn: number;
}
