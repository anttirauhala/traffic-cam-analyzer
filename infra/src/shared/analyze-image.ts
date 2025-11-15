import type { DownloadImageResult } from './download-image';

/**
 * Event passed to analyze-image Lambda (from ImageDownloaded EventBridge event).
 */
export interface AnalyzeImageEvent extends DownloadImageResult {}

/**
 * Replicate API input for YOLO World XL model.
 */
export interface ReplicateInput {
  input_media: string;
  class_names: string;
  score_thr: number;
  nms_thr: number;
  max_num_boxes: number;
  return_json: boolean;
}

/**
 * Bounding box detection from Replicate model.
 */
export interface Detection {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  label: string;
  score: number;
}

/**
 * Parsed JSON output from Replicate model (json_str field).
 */
export interface ReplicateOutput {
  detections: Detection[];
}

/**
 * Full Replicate API prediction response.
 */
export interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: {
    media_path?: string;
    json_str?: string;
  };
  error?: string;
}

/**
 * DynamoDB ImageDetections table item schema.
 */
export interface ImageDetectionItem {
  cameraId: string;
  capturedAtEpoch: number;
  rawImageKey: string;
  processedImageKey: string | null;
  replicateJobId: string;
  capturedAt: string;
  replicateInput: ReplicateInput;
  replicateOutput: ReplicateOutput | null;
  hasWildlife: string; // 'true' or 'false' for DynamoDB GSI
  hasPerson: string; // 'true' or 'false' for DynamoDB GSI
  detectedClasses: string[];
  detectionCount: number;
  alertSent: boolean;
  alertChannel: string | null;
  processingStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  failureReason: string | null;
  processedAtEpoch: number;
}

/**
 * Result returned by analyze-image Lambda.
 */
export interface AnalyzeImageResult {
  cameraId: string;
  capturedAtEpoch: number;
  processingStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  detectionCount: number;
  hasWildlife: boolean;
  hasPerson: boolean;
}
