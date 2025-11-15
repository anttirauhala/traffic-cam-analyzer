/**
 * Camera metadata stored in Cameras table.
 */
export interface CameraItem {
  cameraId: string;
  name: string;
  municipality: string;
  lat: number;
  lon: number;
  latestCaptureEpoch: number;
  firstSeenEpoch: number;
  lastUpdatedEpoch: number;
}
