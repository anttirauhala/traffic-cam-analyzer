import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type {
  AnalyzeImageEvent,
  AnalyzeImageResult,
  Detection,
  ImageDetectionItem,
  ReplicateInput,
  ReplicateOutput,
  ReplicatePrediction,
} from '../../shared/analyze-image';
import type { CameraItem } from '../../shared/camera-metadata';

const RAW_BUCKET_NAME = process.env.RAW_BUCKET_NAME;
const PROCESSED_BUCKET_NAME = process.env.PROCESSED_BUCKET_NAME;
const DETECTIONS_TABLE_NAME = process.env.DETECTIONS_TABLE_NAME;
const CAMERAS_TABLE_NAME = process.env.CAMERAS_TABLE_NAME;
const SECRET_NAME = process.env.SECRET_NAME || 'traffic-cam/replicate-api-key';

if (!RAW_BUCKET_NAME || !PROCESSED_BUCKET_NAME || !DETECTIONS_TABLE_NAME || !CAMERAS_TABLE_NAME) {
  throw new Error('Missing required environment variables');
}

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const eventBridgeClient = new EventBridgeClient({});

// Cache API token to avoid fetching from Secrets Manager on every invocation
let cachedApiToken: string | null = null;
let tokenFetchedAt: number = 0;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const getReplicateApiToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedApiToken && now - tokenFetchedAt < TOKEN_CACHE_TTL_MS) {
    return cachedApiToken;
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: SECRET_NAME,
    }),
  );

  if (!response.SecretString) {
    throw new Error('Replicate API token not found in Secrets Manager');
  }

  cachedApiToken = response.SecretString;
  tokenFetchedAt = now;
  return cachedApiToken!;
};

const MODEL = 'franz-biz/yolo-world-xl:fd1305d3fc19e81540542f51c2530cf8f393e28cc6ff4976337c3e2b75c7c292';
const MAX_NUM_BOXES = 100;
const CONFIDENCE_THRESHOLD = 0.05;
const NMS_THRESHOLD = 0.5;

// Wildlife and person detection classes
const WILDLIFE_CLASSES = [
  'deer',
  'moose',
  'elk',
  'bear',
  'wolf',
  'fox',
  'wild boar',
  'reindeer',
  'hare',
  'rabbit',
  'animal'
];

const PERSON_CLASSES = ['person', 'pedestrian', 'human'];

const CLASS_NAMES = [...WILDLIFE_CLASSES, ...PERSON_CLASSES].join(', ');

/**
 * Generate presigned URL for S3 object (valid for 1 hour).
 */
const generatePresignedUrl = async (bucket: string, key: string): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

/**
 * Call Replicate API to analyze image.
 */
const analyzeWithReplicate = async (imageUrl: string): Promise<ReplicatePrediction> => {
  const apiToken = await getReplicateApiToken();
  const input: ReplicateInput = {
    input_media: imageUrl,
    class_names: CLASS_NAMES,
    score_thr: CONFIDENCE_THRESHOLD,
    nms_thr: NMS_THRESHOLD,
    max_num_boxes: MAX_NUM_BOXES,
    return_json: true,
  };

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      version: MODEL,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Replicate API error: ${response.status} ${errorText}`);
  }

  const prediction = (await response.json()) as ReplicatePrediction;
  return prediction;
};

/**
 * Parse Replicate output and classify detections.
 */
const parseReplicateOutput = (
  prediction: ReplicatePrediction,
): { output: ReplicateOutput | null; processedImageUrl: string | null } => {
  if (prediction.status !== 'succeeded' || !prediction.output) {
    return { output: null, processedImageUrl: null };
  }

  const jsonStr = prediction.output.json_str;
  if (!jsonStr) {
    return { output: null, processedImageUrl: prediction.output.media_path || null };
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const detections: Detection[] = parsed.detections || [];
    return {
      output: { detections },
      processedImageUrl: prediction.output.media_path || null,
    };
  } catch (error) {
    console.error('Failed to parse Replicate JSON output:', error);
    return { output: null, processedImageUrl: prediction.output.media_path || null };
  }
};

/**
 * Classify detections into wildlife and person categories.
 */
const classifyDetections = (
  output: ReplicateOutput,
): { hasWildlife: boolean; hasPerson: boolean; detectedClasses: string[] } => {
  const detectedClasses = new Set<string>();
  let hasWildlife = false;
  let hasPerson = false;

  for (const detection of output.detections) {
    const label = detection.label.toLowerCase();
    detectedClasses.add(label);

    if (WILDLIFE_CLASSES.some((wc) => label.includes(wc))) {
      hasWildlife = true;
    }
    if (PERSON_CLASSES.some((pc) => label.includes(pc))) {
      hasPerson = true;
    }
  }

  return {
    hasWildlife,
    hasPerson,
    detectedClasses: Array.from(detectedClasses),
  };
};

/**
 * Download processed image from Replicate and upload to S3.
 */
const downloadAndUploadProcessedImage = async (
  imageUrl: string,
  cameraId: string,
  objectKey: string,
): Promise<string> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download processed image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);

  // Use same key structure as raw image but in processed bucket
  await s3Client.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: 'image/jpeg',
    }),
  );

  return objectKey;
};

/**
 * Save detection results to DynamoDB.
 */
const saveDetectionResults = async (
  event: AnalyzeImageEvent,
  prediction: ReplicatePrediction,
  replicateOutput: ReplicateOutput | null,
  processedImageKey: string | null,
  processingStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED',
  failureReason: string | null,
): Promise<void> => {
  const capturedAtEpoch = Math.floor(new Date(event.camera.lastUpdated || Date.now()).getTime() / 1000);
  const processedAtEpoch = Math.floor(Date.now() / 1000);

  const classification = replicateOutput
    ? classifyDetections(replicateOutput)
    : { hasWildlife: false, hasPerson: false, detectedClasses: [] };

  const replicateInput: ReplicateInput = {
    input_media: event.rawObjectKey,
    class_names: CLASS_NAMES,
    score_thr: CONFIDENCE_THRESHOLD,
    nms_thr: NMS_THRESHOLD,
    max_num_boxes: MAX_NUM_BOXES,
    return_json: true,
  };

  const item: ImageDetectionItem = {
    cameraId: event.camera.cameraId,
    capturedAtEpoch,
    rawImageKey: event.rawObjectKey,
    processedImageKey,
    replicateJobId: prediction.id,
    capturedAt: new Date(capturedAtEpoch * 1000).toISOString(),
    replicateInput,
    replicateOutput,
    hasWildlife: String(classification.hasWildlife),
    hasPerson: String(classification.hasPerson),
    detectedClasses: classification.detectedClasses,
    detectionCount: replicateOutput?.detections.length || 0,
    alertSent: false,
    alertChannel: null,
    processingStatus,
    failureReason,
    processedAtEpoch,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: DETECTIONS_TABLE_NAME,
      Item: item,
    }),
  );
};

/**
 * Update camera metadata in Cameras table.
 * Creates new camera entry if not exists, otherwise updates timestamp.
 */
const updateCameraMetadata = async (
  cameraId: string,
  name: string,
  municipality: string,
  lat: number,
  lon: number,
  capturedAtEpoch: number,
): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);

  // Try to get existing camera
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: CAMERAS_TABLE_NAME!,
      Key: { cameraId },
    }),
  );

  if (!existing.Item) {
    // Create new camera entry
    const newCamera: CameraItem = {
      cameraId,
      name,
      municipality,
      lat,
      lon,
      latestCaptureEpoch: capturedAtEpoch,
      firstSeenEpoch: now,
      lastUpdatedEpoch: now,
    };

    await dynamoClient.send(
      new PutCommand({
        TableName: CAMERAS_TABLE_NAME!,
        Item: newCamera,
      }),
    );
  } else {
    const camera = existing.Item as CameraItem;
    const updateLatest = capturedAtEpoch > camera.latestCaptureEpoch;

    await dynamoClient.send(
      new UpdateCommand({
        TableName: CAMERAS_TABLE_NAME!,
        Key: { cameraId },
        UpdateExpression:
          'SET #name = :name, municipality = :municipality, lat = :lat, lon = :lon, lastUpdatedEpoch = :now' +
          (updateLatest ? ', latestCaptureEpoch = :capturedAt' : ''),
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':name': name,
          ':municipality': municipality,
          ':lat': lat,
          ':lon': lon,
          ':now': now,
          ...(updateLatest ? { ':capturedAt': capturedAtEpoch } : {}),
        },
      }),
    );
  }
};

const publishImageAnalyzedEvent = async (
  cameraId: string,
  cameraName: string,
  capturedAt: string,
  detectionCount: number,
  hasWildlife: boolean,
  hasPerson: boolean,
  detectedClasses: string[],
): Promise<void> => {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'traffic-cam.analysis',
            DetailType: 'ImageAnalyzed',
            Detail: JSON.stringify({
              cameraId,
              cameraName,
              capturedAt,
              detectionCount,
              hasWildlife,
              hasPerson,
              detectedClasses,
            }),
          },
        ],
      }),
    );
    console.log(`Published ImageAnalyzed event for ${cameraId} with ${detectionCount} detections`);
  } catch (error) {
    console.error('Failed to publish ImageAnalyzed event:', error);
    // Don't throw - alerting is not critical
  }
};

const processAnalysis = async (event: AnalyzeImageEvent): Promise<AnalyzeImageResult> => {
  const imageUrl = await generatePresignedUrl(event.rawBucketName, event.rawObjectKey);

  try {
    const prediction = await analyzeWithReplicate(imageUrl);

    if (prediction.status === 'failed') {
      await saveDetectionResults(event, prediction, null, null, 'FAILED', prediction.error || 'Replicate job failed');
      return {
        cameraId: event.camera.cameraId,
        capturedAtEpoch: Math.floor(new Date(event.camera.lastUpdated || Date.now()).getTime() / 1000),
        processingStatus: 'FAILED',
        detectionCount: 0,
        hasWildlife: false,
        hasPerson: false,
      };
    }

    const { output, processedImageUrl } = parseReplicateOutput(prediction);

    let processedImageKey: string | null = null;
    if (processedImageUrl) {
      try {
        processedImageKey = await downloadAndUploadProcessedImage(
          processedImageUrl,
          event.camera.cameraId,
          event.rawObjectKey,
        );
      } catch (error) {
        console.warn('Failed to download processed image:', error);
      }
    }

    if (!output) {
      await saveDetectionResults(
        event,
        prediction,
        null,
        processedImageKey,
        'FAILED',
        'Missing json_str in Replicate output',
      );
      return {
        cameraId: event.camera.cameraId,
        capturedAtEpoch: Math.floor(new Date(event.camera.lastUpdated || Date.now()).getTime() / 1000),
        processingStatus: 'FAILED',
        detectionCount: 0,
        hasWildlife: false,
        hasPerson: false,
      };
    }

    const classification = classifyDetections(output);
    await saveDetectionResults(event, prediction, output, processedImageKey, 'SUCCESS', null);

    const capturedAtEpoch = Math.floor(new Date(event.camera.lastUpdated || Date.now()).getTime() / 1000);

    // Update camera metadata
    const cameraName = event.camera.presetName 
      ? `${event.camera.stationName} - ${event.camera.presetName}`
      : event.camera.stationName;
    
    await updateCameraMetadata(
      event.camera.cameraId,
      cameraName,
      event.camera.metadata.municipality || 'Unknown',
      event.camera.lat,
      event.camera.lon,
      capturedAtEpoch,
    );

    // Publish ImageAnalyzed event for alerting
    if (output.detections.length > 0) {
      await publishImageAnalyzedEvent(
        event.camera.cameraId,
        cameraName,
        event.camera.lastUpdated || new Date().toISOString(),
        output.detections.length,
        classification.hasWildlife,
        classification.hasPerson,
        output.detections.map(d => d.label),
      );
    }

    return {
      cameraId: event.camera.cameraId,
      capturedAtEpoch,
      processingStatus: 'SUCCESS',
      detectionCount: output.detections.length,
      hasWildlife: classification.hasWildlife,
      hasPerson: classification.hasPerson,
    };
  } catch (error) {
    console.error('Analysis failed:', error);

    // Create a minimal prediction object for error case
    const errorPrediction: ReplicatePrediction = {
      id: 'error-' + Date.now(),
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };

    await saveDetectionResults(event, errorPrediction, null, null, 'FAILED', errorPrediction.error || 'Unknown error');

    return {
      cameraId: event.camera.cameraId,
      capturedAtEpoch: Math.floor(new Date(event.camera.lastUpdated || Date.now()).getTime() / 1000),
      processingStatus: 'FAILED',
      detectionCount: 0,
      hasWildlife: false,
      hasPerson: false,
    };
  }
};

export const handler = async (sqsEvent: SQSEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  const results: AnalyzeImageResult[] = [];
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of sqsEvent.Records) {
    try {
      const eventBridgeWrapper = JSON.parse(record.body);
      const event: AnalyzeImageEvent = eventBridgeWrapper.detail || eventBridgeWrapper;
      const result = await processAnalysis(event);
      
      // If processing failed (rate limit), report to SQS for retry
      if (result.processingStatus === 'FAILED') {
        console.warn(`Analysis failed for ${result.cameraId}, will retry`);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      } else {
        results.push(result);
      }
    } catch (error) {
      console.error(`Failed to process record ${record.messageId}:`, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  console.log(`Successfully analyzed ${results.length} images`);
  if (results.length > 0) {
    console.log(
      `Wildlife detections: ${results.filter((r) => r.hasWildlife).length}, Person detections: ${results.filter((r) => r.hasPerson).length}`,
    );
  }
  
  if (batchItemFailures.length > 0) {
    console.log(`${batchItemFailures.length} messages will be retried by SQS`);
  }

  return { batchItemFailures };
};
