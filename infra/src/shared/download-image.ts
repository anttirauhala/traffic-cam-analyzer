import type { CameraItem } from './camera-items';

/**
 * Step Functions Map iterator event for download-image Lambda.
 */
export interface DownloadImageEvent {
  camera: CameraItem;
  /**
   * Signals whether this frame must bypass lifecycle-based deletion.
   * Analyzer sets this to true if an alert-worthy detection occurs.
   */
  archivalRequired?: boolean;
}

/**
 * Payload passed to the analyze-image Lambda once the original file is persisted.
 */
export interface DownloadImageResult extends DownloadImageEvent {
  rawBucketName: string;
  rawObjectKey: string;
  rawObjectETag: string | null;
  imageContentType: string | null;
  imageSizeBytes: number;
  downloadedAtIso: string;
}
