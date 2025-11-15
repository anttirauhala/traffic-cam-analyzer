/**
 * API request and response types for the REST API.
 */

export interface ListDetectionsRequest {
  limit?: number;
  nextToken?: string;
  hasWildlife?: 'true' | 'false';
  hasPerson?: 'true' | 'false';
  cameraId?: string;
  startDate?: string; // ISO date string or epoch timestamp
  endDate?: string; // ISO date string or epoch timestamp
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

export interface ListDetectionsResponse {
  items: DetectionSummary[];
  nextToken?: string;
  count: number;
}

export interface Detection {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  label: string;
  score: number;
}

export interface DetectionDetail extends DetectionSummary {
  replicateJobId: string;
  replicateOutput: {
    detections: Detection[];
  } | null;
  failureReason: string | null;
  processedAtEpoch: number;
}

export interface GetDetectionResponse {
  detection: DetectionDetail;
}

export interface CameraSummary {
  cameraId: string;
  name: string;
  municipality: string;
  lat: number;
  lon: number;
  latestCaptureEpoch: number;
}

export interface ListCamerasResponse {
  cameras: CameraSummary[];
}

export interface GetImageUrlRequest {
  bucket: 'raw' | 'processed';
  key: string;
}

export interface GetImageUrlResponse {
  url: string;
  expiresIn: number; // seconds
}

export interface CameraTimestamp {
  capturedAtEpoch: number;
  capturedAt: string;
  hasWildlife: boolean;
  hasPerson: boolean;
  processingStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
}

export interface ListCameraTimestampsResponse {
  cameraId: string;
  timestamps: CameraTimestamp[];
  count: number;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
}
