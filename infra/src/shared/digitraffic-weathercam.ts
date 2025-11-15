/** Shared interfaces describing DigiTraffic weather camera stations and presets. */

export interface IGeographicalLocation {
  latitude: number;
  longitude: number;
}

export interface IDigiTrafficPreset {
  id: string | null;
  presentationName?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  measuredTime?: string | null;
  dataUpdatedTime?: string | null;
  inCollection?: boolean | null;
}

export interface IStation {
  id: string | null;
  roadStationId: string | null;
  name: string | null;
  names?: Record<string, string> | null;
  collectionStatus: string | null;
  state: string | null;
  stateUpdatedTime: string | null;
  municipality: string | null;
  cameraType?: string | null;
  geographicalLocation: IGeographicalLocation | null;
  cameraPresets: IDigiTrafficPreset[];
  presets: IDigiTrafficPreset[];
}
