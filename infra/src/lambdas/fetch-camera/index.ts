import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { IDigiTrafficPreset, IStation } from '../../shared/digitraffic-weathercam';
import type { CameraItem, CameraItemMetadata } from '../../shared/camera-items';

const DIGITRAFFIC_WEATHERCAM_API =
  process.env.DIGITRAFFIC_WEATHERCAM_API_URL ?? 'https://tie.digitraffic.fi/api/weathercam/v1/stations';

const TAMPERE_COORDS = {
  lat: Number(process.env.TAMPERE_LAT ?? 61.4978),
  lon: Number(process.env.TAMPERE_LON ?? 23.761),
};

const DEFAULT_MAX_DISTANCE_KM = Number(process.env.MAX_CAMERA_DISTANCE_KM ?? 5);

const DIGITRAFFIC_PRESET_API = process.env.DIGITRAFFIC_PRESET_API_URL ?? 'https://tie.digitraffic.fi/api/weathercam/v1';
const DIGITRAFFIC_IMAGE_BASE_URL = process.env.DIGITRAFFIC_IMAGE_BASE_URL ?? 'https://weathercam.digitraffic.fi';

const OPERATIONAL_COLLECTION_STATUSES = new Set(['GATHERING']);

const eventBridgeClient = new EventBridgeClient({});

const toIdentifier = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return value == null ? null : null;
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const toNullableBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return value == null ? null : null;
};

const getStringFromRecord = (record: Record<string, unknown>, key: string): string | null => {
  return toNullableString(record[key]);
};

const toStringRecord = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      output[key] = entry;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
};

const pickPreferredStationName = (
  source: { name?: string | null; names?: Record<string, string> | null | undefined },
  fallback?: string | null,
): string | null => {
  if (source.names) {
    const { fi, en, sv } = source.names;
    if (fi) return fi;
    if (en) return en;
    if (sv) return sv;
    const first = Object.values(source.names).find((value) => Boolean(value));
    if (first) {
      return first;
    }
  }
  return source.name ?? fallback ?? null;
};

const buildPresetImageUrl = (presetId: string | null | undefined): string | null => {
  if (typeof presetId !== 'string') {
    return null;
  }
  const trimmed = presetId.trim();
  if (!trimmed) {
    return null;
  }
  const base = DIGITRAFFIC_IMAGE_BASE_URL.endsWith('/')
    ? DIGITRAFFIC_IMAGE_BASE_URL.slice(0, -1)
    : DIGITRAFFIC_IMAGE_BASE_URL;
  return `${base}/${encodeURIComponent(trimmed)}.jpg`;
};

interface StationsApiPayload {
  stations?: IStation[];
  features?: DigiTrafficFeature[];
}

interface DigiTrafficFeature {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: Partial<IStation> & { presets?: unknown[]; dataUpdatedTime?: string | null };
}

const toDigiTrafficFeature = (payload: unknown): DigiTrafficFeature | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown> & {
    properties?: DigiTrafficFeature['properties'];
    geometry?: DigiTrafficFeature['geometry'];
  };

  if (record.properties || record.geometry) {
    return {
      geometry: record.geometry,
      properties: record.properties ?? {},
    };
  }

  return {
    properties: record as DigiTrafficFeature['properties'],
  };
};

const mergeStationData = (base: IStation, detail: IStation): IStation => {
  return {
    id: detail.id ?? base.id ?? null,
    roadStationId: detail.roadStationId ?? base.roadStationId ?? null,
    name: detail.name ?? base.name ?? null,
    names: detail.names ?? base.names ?? null,
    collectionStatus: detail.collectionStatus ?? base.collectionStatus ?? null,
    state: detail.state ?? base.state ?? null,
    stateUpdatedTime: detail.stateUpdatedTime ?? base.stateUpdatedTime ?? null,
    municipality: detail.municipality ?? base.municipality ?? null,
    cameraType: detail.cameraType ?? base.cameraType ?? null,
    geographicalLocation: detail.geographicalLocation ?? base.geographicalLocation ?? null,
    cameraPresets:
      detail.cameraPresets && detail.cameraPresets.length > 0
        ? detail.cameraPresets
        : base.cameraPresets,
    presets:
      detail.presets && detail.presets.length > 0
        ? detail.presets
        : base.presets,
  };
};

interface PresetDetail {
  imageUrl: string | null;
  presentationName: string | null;
  measuredTime: string | null;
}

const stationDetailCache = new Map<string, IStation>();
const presetDetailCache = new Map<string, PresetDetail | null>();

interface StationDataSnapshot {
  dataUpdatedTime: string | null;
  presetMeasuredTimes: Map<string, string>;
}

const stationDataCache = new Map<string, StationDataSnapshot | null>();

export const handler = async (): Promise<{ camerasPublished: number }> => {
  console.time('fetch-camera:total');
  const stations = await fetchStations();
  console.log(`Fetched ${stations.length} station candidates`);
  const cameras = await flattenAndFilter(stations, DEFAULT_MAX_DISTANCE_KM);
  console.log(`Selected ${cameras.length} cameras within ${DEFAULT_MAX_DISTANCE_KM}km`);
  
  await publishCameraEvents(cameras);
  
  console.timeEnd('fetch-camera:total');
  return { camerasPublished: cameras.length };
};

const fetchStations = async (): Promise<IStation[]> => {
  console.time('fetch-camera:stations');
  const response = await fetch(DIGITRAFFIC_WEATHERCAM_API);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch DigiTraffic stations: ${response.status} ${response.statusText} - ${text}`,
    );
  }

  const payload = (await response.json()) as StationsApiPayload | null;
  console.timeEnd('fetch-camera:stations');
  if (!payload) {
    throw new Error('Unexpected DigiTraffic payload: empty response');
  }

  if (Array.isArray(payload.stations)) {
    return payload.stations;
  }

  if (Array.isArray(payload.features)) {
    return payload.features.map(normalizeFeatureStation).filter(isStation);
  }

  throw new Error('Unexpected DigiTraffic payload: missing stations/features array');
};

const flattenAndFilter = async (stations: IStation[], maxDistanceKm: number): Promise<CameraItem[]> => {
  const items: CameraItem[] = [];
  let stationsWithinRadius = 0;
  let presetsConsidered = 0;

  for (const station of stations) {
    if (!isStationOperational(station)) {
      continue;
    }

    let enrichedStation: IStation = station;
    let location = extractLocation(enrichedStation);
    let detailsLoaded = false;

    if (!location) {
      enrichedStation = await ensureStationDetails(station);
      detailsLoaded = true;
      location = extractLocation(enrichedStation);
    }

    if (!location) {
      continue;
    }

    const distanceKm = haversineDistanceKm(
      TAMPERE_COORDS.lat,
      TAMPERE_COORDS.lon,
      location.lat,
      location.lon,
    );
    if (distanceKm > maxDistanceKm) {
      continue;
    }

    stationsWithinRadius += 1;

    if (!detailsLoaded) {
      console.log(`Loading details for station ${enrichedStation.id ?? enrichedStation.roadStationId}`);
      enrichedStation = await ensureStationDetails(station);
      detailsLoaded = true;
    }

    const presets = extractPresets(enrichedStation);
    presetsConsidered += presets.length;
    for (const preset of presets) {
      if (!preset?.id) {
        continue;
      }

      if (preset.inCollection === false) {
        continue;
      }

      // Skip road surface cameras (presentationName contains "tienpinta" or "surface")
      const presetName = (preset.presentationName ?? preset.name ?? '').toLowerCase();
      if (presetName.includes('tienpinta') || presetName.includes('surface')) {
        continue;
      }

      const stationId = enrichedStation.id ?? enrichedStation.roadStationId ?? null;
      const detail = preset.imageUrl ? null : await fetchPresetDetail(stationId, preset.id);
      // Always fetch fresh measuredTime from /data endpoint for accurate capture time
      const measuredTime = await resolveMeasuredTime(stationId, preset.id, null);
      const fallbackImageUrl = buildPresetImageUrl(preset.id);
      const imageUrl = preset.imageUrl ?? detail?.imageUrl ?? fallbackImageUrl;

      if (!imageUrl) {
        continue;
      }

      items.push({
        cameraId: `${enrichedStation.id ?? enrichedStation.roadStationId ?? preset.id}:${preset.id}`,
        stationId: enrichedStation.id ?? null,
        roadStationId: enrichedStation.roadStationId ?? null,
        stationName:
          pickPreferredStationName(
            { name: enrichedStation.name, names: enrichedStation.names },
            preset.presentationName ?? detail?.presentationName ?? 'unknown',
          ) ?? 'unknown',
        presetId: preset.id,
        presetName: preset.presentationName ?? detail?.presentationName ?? null,
        imageUrl,
        lastUpdated: measuredTime ?? enrichedStation.stateUpdatedTime ?? null,
        lat: location.lat,
        lon: location.lon,
        distanceKm,
        metadata: {
          state: enrichedStation.state ?? null,
          collectionStatus: enrichedStation.collectionStatus ?? null,
          municipality: enrichedStation.municipality ?? null,
          cameraType: enrichedStation.cameraType ?? null,
          presetInCollection: preset.inCollection ?? null,
        },
      });
    }
  }

  console.log(
    `Stations within radius: ${stationsWithinRadius}, presets evaluated: ${presetsConsidered}, cameras kept: ${items.length}`,
  );

  return items.sort((a, b) => a.distanceKm - b.distanceKm);
};

const isStationOperational = (station: IStation): boolean => {
  const collectionStatus = station?.collectionStatus;
  return collectionStatus == null || OPERATIONAL_COLLECTION_STATUSES.has(collectionStatus);
};

const extractLocation = (station: IStation): { lat: number; lon: number } | null => {
  const geo = station?.geographicalLocation;
  if (!geo || typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') {
    return null;
  }
  return { lat: geo.latitude, lon: geo.longitude };
};

const ensureStationDetails = async (station: IStation): Promise<IStation> => {
  const hasImagePresets =
    Array.isArray(station.cameraPresets) && station.cameraPresets.some((preset) => Boolean(preset?.imageUrl));

  const hasLocalizedNames = Boolean(station.names && Object.keys(station.names).length > 0);
  const needsMetadataEnrichment = !hasLocalizedNames || station.cameraType == null;

  if (hasImagePresets && !needsMetadataEnrichment) {
    return station;
  }

  const stationId = station?.id ?? station?.roadStationId;
  if (!stationId) {
    return station;
  }

  const cached = stationDetailCache.get(stationId);
  if (cached) {
    return cached;
  }

  try {
    const url = `${DIGITRAFFIC_PRESET_API}/stations/${encodeURIComponent(stationId)}`;
    console.log(`Fetching details for station ${stationId}`);
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(
          `Failed to fetch station detail ${stationId}: ${response.status} ${response.statusText}`,
        );
      }
      stationDetailCache.set(stationId, station);
      return station;
    }

    const feature = toDigiTrafficFeature(await response.json());
    const normalizedDetail = feature ? normalizeFeatureStation(feature) : null;

    if (!normalizedDetail) {
      stationDetailCache.set(stationId, station);
      return station;
    }

    const detailedStation = mergeStationData(station, normalizedDetail);

    stationDetailCache.set(stationId, detailedStation);
    return detailedStation;
  } catch (error) {
    console.warn(`Error fetching station detail ${stationId}: ${error}`);
    stationDetailCache.set(stationId, station);
    return station;
  }
};

const extractPresets = (station: IStation): IDigiTrafficPreset[] => {
  if (Array.isArray(station.cameraPresets) && station.cameraPresets.length > 0) {
    return normalizePresetList(station.cameraPresets);
  }

  if (Array.isArray(station.presets)) {
    return normalizePresetList(station.presets);
  }

  return [];
};

const normalizePresetList = (presets: unknown[]): IDigiTrafficPreset[] => {
  return presets
    .map((preset) => normalizePreset(preset))
    .filter((preset): preset is IDigiTrafficPreset => preset !== null);
};

const normalizePreset = (preset: unknown): IDigiTrafficPreset | null => {
  if (!preset || typeof preset !== 'object') {
    return null;
  }

  const data = preset as Record<string, unknown>;

  const id = toIdentifier(data.id);

  if (id === null) {
    return null;
  }

  return {
    id,
    presentationName: toNullableString(data.presentationName),
    name: toNullableString(data.name),
    imageUrl:
      toNullableString(data.imageUrl) ??
      getStringFromRecord(data, 'cameraPresetUrl') ??
      getStringFromRecord(data, 'cameraPresetImageUrl') ??
      buildPresetImageUrl(id),
    measuredTime: toNullableString(data.measuredTime) ?? toNullableString(data.dataUpdatedTime),
    dataUpdatedTime: toNullableString(data.dataUpdatedTime) ?? undefined,
    inCollection: toNullableBoolean(data.inCollection),
  };
};

const haversineDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth radius in km
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const degreesToRadians = (deg: number): number => {
  return deg * (Math.PI / 180);
};

const normalizeFeatureStation = (feature: DigiTrafficFeature): IStation | null => {
  if (!feature || typeof feature !== 'object') {
    return null;
  }

  const geometry = feature.geometry;
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  const latitude = coordinates.length >= 2 ? Number(coordinates[1]) : Number.NaN;
  const longitude = coordinates.length >= 2 ? Number(coordinates[0]) : Number.NaN;

  const geoLocation =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? {
          latitude,
          longitude,
        }
      : null;

  const properties = feature.properties ?? {};

  const cameraPresets = Array.isArray(properties.cameraPresets)
    ? normalizePresetList(properties.cameraPresets as unknown[])
    : [];

  const presets = Array.isArray(properties.presets)
    ? normalizePresetList(properties.presets)
    : [];

  const names = toStringRecord((properties as Record<string, unknown>)?.names);

  return {
    id: toIdentifier(properties.id),
    roadStationId: toIdentifier(properties.roadStationId),
    name: pickPreferredStationName({ name: toNullableString(properties.name), names }, null),
    names,
    collectionStatus: toNullableString(properties.collectionStatus),
    state: toNullableString(properties.state),
    stateUpdatedTime: toNullableString(properties.stateUpdatedTime ?? properties.dataUpdatedTime),
    municipality: toNullableString(properties.municipality),
    cameraType: toNullableString((properties as Record<string, unknown>)?.cameraType),
    geographicalLocation: geoLocation,
    cameraPresets,
    presets,
  };
};

const   fetchPresetDetail = async (stationId: string | null, presetId: string): Promise<PresetDetail | null> => {
  if (!stationId) {
    return null;
  }

  const cacheKey = `${stationId}:${presetId}`;
  const cached = presetDetailCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const url = `${DIGITRAFFIC_PRESET_API}/stations/${encodeURIComponent(stationId)}/presets/${encodeURIComponent(
    presetId,
  )}`;

  try {
    console.log(`Fetching preset ${stationId}/${presetId}`);
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(
          `Failed to fetch preset ${stationId}/${presetId}: ${response.status} ${response.statusText}`,
        );
      }
      presetDetailCache.set(cacheKey, null);
      return null;
    }

    const json = (await response.json()) as Partial<PresetDetail> | Record<string, unknown> | null;
    const jsonRecord = (json ?? {}) as Record<string, unknown>;

    const detail: PresetDetail = {
      imageUrl:
        toNullableString(json?.imageUrl) ??
        getStringFromRecord(jsonRecord, 'cameraPresetUrl') ??
        getStringFromRecord(jsonRecord, 'cameraPresetImageUrl') ??
        buildPresetImageUrl(presetId),
      presentationName: toNullableString(json?.presentationName) ?? getStringFromRecord(jsonRecord, 'name'),
      measuredTime:
        toNullableString(json?.measuredTime) ?? getStringFromRecord(jsonRecord, 'dataUpdatedTime') ?? null,
    };

    presetDetailCache.set(cacheKey, detail);
    return detail;
  } catch (error) {
    console.warn(`Error fetching preset ${stationId}/${presetId}: ${error}`);
    presetDetailCache.set(cacheKey, null);
    return null;
  }
};

const isStation = (station: IStation | null): station is IStation => Boolean(station);

const publishCameraEvents = async (cameras: CameraItem[]): Promise<void> => {
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < cameras.length; i += BATCH_SIZE) {
    const batch = cameras.slice(i, i + BATCH_SIZE);
    const entries = batch.map((camera) => ({
      Source: 'traffic-cam.ingest',
      DetailType: 'CameraFetched',
      Detail: JSON.stringify({ camera }),
    }));

    try {
      const command = new PutEventsCommand({ Entries: entries });
      const result = await eventBridgeClient.send(command);
      
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.warn(`Failed to publish ${result.FailedEntryCount} events:`, result.Entries);
      }
    } catch (error) {
      console.error(`Error publishing camera events batch ${i}-${i + batch.length}:`, error);
      throw error;
    }
  }
  
  console.log(`Published ${cameras.length} camera events to EventBridge`);
};

const resolveMeasuredTime = async (
  stationId: string | null,
  presetId: string,
  currentMeasuredTime: string | null,
): Promise<string | null> => {
  if (currentMeasuredTime) {
    return currentMeasuredTime;
  }
  if (!stationId) {
    return null;
  }

  const snapshot = await fetchStationDataSnapshot(stationId);
  if (!snapshot) {
    return null;
  }

  const direct = snapshot.presetMeasuredTimes.get(presetId);
  if (direct) {
    return direct;
  }

  return snapshot.dataUpdatedTime;
};

const fetchStationDataSnapshot = async (stationId: string): Promise<StationDataSnapshot | null> => {
  const cached = stationDataCache.get(stationId);
  if (cached !== undefined) {
    return cached;
  }

  const url = `${DIGITRAFFIC_PRESET_API}/stations/${encodeURIComponent(stationId)}/data`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`Failed to fetch station data snapshot ${stationId}: ${response.status} ${response.statusText}`);
      }
      stationDataCache.set(stationId, null);
      return null;
    }

    interface SnapshotPayload {
      dataUpdatedTime?: string | null;
      presets?: Array<{ id?: string; measuredTime?: string | null }>;
    }

    const json = (await response.json()) as SnapshotPayload | null;
    if (!json) {
      stationDataCache.set(stationId, null);
      return null;
    }

    const measuredTimes = new Map<string, string>();
    if (Array.isArray(json.presets)) {
      for (const preset of json.presets) {
        if (!preset?.id || !preset.measuredTime) {
          continue;
        }
        measuredTimes.set(preset.id, preset.measuredTime);
      }
    }

    const snapshot: StationDataSnapshot = {
      dataUpdatedTime: json.dataUpdatedTime ?? null,
      presetMeasuredTimes: measuredTimes,
    };

    stationDataCache.set(stationId, snapshot);
    return snapshot;
  } catch (error) {
    console.warn(`Error fetching station data snapshot ${stationId}: ${error}`);
    stationDataCache.set(stationId, null);
    return null;
  }
};

if (require.main === module) {
  handler()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}