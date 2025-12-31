import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { EventBridgeEvent } from 'aws-lambda';

interface DetectionAlert {
  cameraId: string;
  cameraName: string;
  capturedAt: string;
  detectionCount: number;
  hasWildlife: boolean;
  hasPerson: boolean;
  detectedClasses: string[];
  processedObjectKey: string;
  rawObjectKey?: string;
  rawBucketName?: string;
}

const TOPIC_ARN = process.env.ALERT_TOPIC_ARN;
const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET_NAME;
const RAW_BUCKET = process.env.RAW_BUCKET_NAME;

if (!TOPIC_ARN) {
  throw new Error('Missing required environment variable: ALERT_TOPIC_ARN');
}

if (!PROCESSED_BUCKET) {
  throw new Error('Missing required environment variable: PROCESSED_BUCKET_NAME');
}

const snsClient = new SNSClient({});
const s3Client = new S3Client({});

export const handler = async (event: EventBridgeEvent<'ImageAnalyzed', DetectionAlert>): Promise<void> => {
  console.log('Processing alert event:', JSON.stringify(event, null, 2));

  const detection = event.detail;

  // Only send alert if there are detections
  if (detection.detectionCount === 0) {
    console.log('No detections, skipping alert');
    return;
  }

  // Determine which bucket and key to use for the image
  // Prefer processed image, fallback to raw image
  let imageBucket: string;
  let imageKey: string;
  
  if (detection.processedObjectKey && detection.processedObjectKey !== detection.rawObjectKey) {
    // We have a processed image
    imageBucket = PROCESSED_BUCKET;
    imageKey = detection.processedObjectKey;
  } else if (detection.rawObjectKey && RAW_BUCKET) {
    // Fallback to raw image
    imageBucket = RAW_BUCKET;
    imageKey = detection.rawObjectKey;
  } else {
    // Last resort: use processedObjectKey in processed bucket (original behavior)
    imageBucket = PROCESSED_BUCKET;
    imageKey = detection.processedObjectKey;
  }

  // Generate presigned URL for the image (valid for 24 hours)
  const imageUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: imageBucket,
      Key: imageKey,
    }),
    { expiresIn: 86400 }, // 24 hours
  );

  const subject = `🔔 Kamerahavainto: ${detection.cameraName}`;
  
  const message = buildAlertMessage(detection, imageUrl);

  try {
    await snsClient.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        Subject: subject,
        Message: message,
      }),
    );

    console.log(`Alert sent for camera ${detection.cameraId} with ${detection.detectionCount} detections`);
  } catch (error) {
    console.error('Failed to send alert:', error);
    throw error;
  }
};

const buildAlertMessage = (detection: DetectionAlert, imageUrl: string): string => {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════');
  lines.push('  LIIKENEKAMERA - UUSI HAVAINTO');
  lines.push('═══════════════════════════════════════');
  lines.push('');
  
  lines.push(`📍 Kamera: ${detection.cameraName}`);
  lines.push(`🕐 Aika: ${new Date(detection.capturedAt).toLocaleString('fi-FI')}`);
  lines.push(`🔢 Havainnot: ${detection.detectionCount} kpl`);
  lines.push('');
  
  if (detection.hasWildlife || detection.hasPerson) {
    lines.push('🔎 Tunnistetut kohteet:');
    if (detection.hasWildlife) {
      lines.push('   🦌 Villieläin havaittu');
    }
    if (detection.hasPerson) {
      lines.push('   👤 Henkilö havaittu');
    }
    lines.push('');
  }
  
  if (detection.detectedClasses.length > 0) {
    lines.push('📋 Luokat:');
    detection.detectedClasses.forEach(cls => {
      lines.push(`   • ${cls}`);
    });
    lines.push('');
  }
  
  lines.push('🖼️  Analysoidun kuvan linkki (voimassa 24h):');
  lines.push(imageUrl);
  lines.push('');
  
  lines.push('───────────────────────────────────────');
  lines.push('');
  lines.push('Tämä on automaattinen ilmoitus AI-pohjaisesta');
  lines.push('liikenekameravalvonnasta.');
  
  return lines.join('\n');
};
