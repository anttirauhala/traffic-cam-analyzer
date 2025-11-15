export interface CameraItemMetadata {
  state: string | null;
  collectionStatus: string | null;
  municipality: string | null;
  cameraType: string | null;
  presetInCollection: boolean | null;
}

export interface CameraItem {
  cameraId: string;
  stationId: string | null;
  roadStationId: string | null;
  stationName: string;
  presetId: string;
  presetName: string | null;
  imageUrl: string;
  lastUpdated: string | null;
  lat: number;
  lon: number;
  distanceKm: number;
  metadata: CameraItemMetadata;
}
