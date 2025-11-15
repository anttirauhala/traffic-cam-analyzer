import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { DownloadImageEvent, DownloadImageResult } from '../../shared/download-image';
import type { CameraItem } from '../../shared/camera-items';

const RAW_BUCKET_NAME = process.env.RAW_BUCKET_NAME;

if (!RAW_BUCKET_NAME) {
  throw new Error('RAW_BUCKET_NAME environment variable is not defined.');
}

const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

const sanitizeSegment = (value: string | null | undefined, fallback: string): string => {
  const cleaned = (value ?? fallback).replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return trimmed.length > 0 ? trimmed : fallback;
};

const inferExtension = (sourceUrl: string, contentType: string | null): string => {
  const type = contentType?.toLowerCase() ?? '';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';

  const loweredUrl = sourceUrl.toLowerCase();
  if (loweredUrl.endsWith('.png')) return 'png';
  if (loweredUrl.endsWith('.webp')) return 'webp';
  if (loweredUrl.endsWith('.jpeg') || loweredUrl.endsWith('.jpg')) return 'jpg';

  return 'jpg';
};

const deriveTimestampSegments = (camera: CameraItem): { iso: string; keySegment: string } => {
  const fallback = new Date();
  const parsed = camera.lastUpdated ? new Date(camera.lastUpdated) : fallback;
  const timestamp = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  const iso = timestamp.toISOString();
  const keySegment = iso.replace(/[:.]/g, '-');
  return { iso, keySegment };
};

const buildObjectKey = (camera: CameraItem, extension: string, timestampKeySegment: string): string => {
  const stationSegment = sanitizeSegment(camera.stationId ?? camera.cameraId, 'unknown-station');
  const presetSegment = sanitizeSegment(camera.presetId, 'preset');
  return `${stationSegment}/${presetSegment}/${timestampKeySegment}/raw.${extension}`;
};

const defaultContentTypeForExtension = (extension: string): string => {
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    default:
      return 'image/jpeg';
  }
};

const toS3Metadata = (camera: CameraItem, capturedAtIso: string | null): Record<string, string> => {
  const metadata: Record<string, string> = {
    cameraid: camera.cameraId,
    presetid: camera.presetId,
  };

  if (camera.stationId) {
    metadata.stationid = camera.stationId;
  }
  if (camera.roadStationId) {
    metadata.roadstationid = camera.roadStationId;
  }
  if (camera.stationName) {
    metadata.stationname = camera.stationName;
  }
  if (camera.lastUpdated) {
    metadata.lastupdated = camera.lastUpdated;
  }
  if (Number.isFinite(camera.distanceKm)) {
    metadata.distancekm = camera.distanceKm.toFixed(3);
  }
  if (capturedAtIso) {
    metadata.capturedat = capturedAtIso;
  }

  const meta = camera.metadata ?? {};
  if (meta.municipality) {
    metadata.municipality = meta.municipality;
  }
  if (meta.collectionStatus) {
    metadata.collectionstatus = meta.collectionStatus;
  }
  if (meta.cameraType) {
    metadata.cameratype = meta.cameraType;
  }
  if (meta.state) {
    metadata.stationstate = meta.state;
  }
  if (meta.presetInCollection != null) {
    metadata.presetincollection = String(Boolean(meta.presetInCollection));
  }

  return metadata;
};

const ensureCamera = (event: DownloadImageEvent): CameraItem => {
  if (!event || typeof event !== 'object') {
    throw new Error('Event payload is missing.');
  }
  if (!event.camera) {
    throw new Error('Event payload does not include the camera object.');
  }
  return event.camera;
};

const fetchImage = async (url: string): Promise<{ body: Buffer; contentType: string | null }> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type');
  return { body, contentType };
};

export const handler = async (sqsEvent: SQSEvent): Promise<void> => {
  const results: DownloadImageResult[] = [];
  const failures: Array<{ record: SQSRecord; error: Error }> = [];

  for (const record of sqsEvent.Records) {
    try {
      const eventBridgeWrapper = JSON.parse(record.body);
      const event: DownloadImageEvent = eventBridgeWrapper.detail || eventBridgeWrapper;
      const result = await processDownload(event);
      results.push(result);
    } catch (error) {
      console.error(`Failed to process record ${record.messageId}:`, error);
      failures.push({ record, error: error as Error });
    }
  }

  if (results.length > 0) {
    await publishDownloadedEvents(results);
  }

  if (failures.length > 0) {
    console.warn(`${failures.length} records failed processing`);
    throw new Error(`Failed to process ${failures.length} of ${sqsEvent.Records.length} records`);
  }

  console.log(`Successfully processed ${results.length} images`);
};

const processDownload = async (event: DownloadImageEvent): Promise<DownloadImageResult> => {
  const camera = ensureCamera(event);

  if (!camera.imageUrl) {
    throw new Error(`Camera ${camera.cameraId} is missing imageUrl.`);
  }

  const { body, contentType } = await fetchImage(camera.imageUrl);
  const { iso: capturedAtIso, keySegment } = deriveTimestampSegments(camera);
  const extension = inferExtension(camera.imageUrl, contentType);
  const objectKey = buildObjectKey(camera, extension, keySegment);

  const archivalRequired = event.archivalRequired === true;
  const putCommand = new PutObjectCommand({
    Bucket: RAW_BUCKET_NAME,
    Key: objectKey,
    Body: body,
    ContentType: contentType ?? defaultContentTypeForExtension(extension),
    Metadata: toS3Metadata(camera, capturedAtIso),
    Tagging: `archivalRequired=${archivalRequired ? 'true' : 'false'}`,
  });

  const putResult = await s3Client.send(putCommand);

  return {
    ...event,
    archivalRequired,
    rawBucketName: RAW_BUCKET_NAME,
    rawObjectKey: objectKey,
    rawObjectETag: putResult.ETag ?? null,
    imageContentType: contentType ?? defaultContentTypeForExtension(extension),
    imageSizeBytes: body.byteLength,
    downloadedAtIso: new Date().toISOString(),
  };
};

const publishDownloadedEvents = async (results: DownloadImageResult[]): Promise<void> => {
  console.log(`Publishing ${results.length} ImageDownloaded events to EventBridge`);
  
  const entries = results.map((result) => ({
    Source: 'traffic-cam.ingest',
    DetailType: 'ImageDownloaded',
    Detail: JSON.stringify(result),
  }));

  try {
    const command = new PutEventsCommand({ Entries: entries });
    const response = await eventBridgeClient.send(command);

    console.log(`EventBridge response: ${JSON.stringify(response)}`);
    
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.warn(`Failed to publish ${response.FailedEntryCount} ImageDownloaded events`);
    } else {
      console.log(`Successfully published ${results.length} ImageDownloaded events`);
    }
  } catch (error) {
    console.error('Error publishing ImageDownloaded events:', error);
    throw error;
  }
};