import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { EventBridgeEvent } from 'aws-lambda';

interface DetectionAlert {
  cameraId: string;
  cameraName: string;
  capturedAt: string;
  detectionCount: number;
  hasWildlife: boolean;
  hasPerson: boolean;
  detectedClasses: string[];
}

const TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

if (!TOPIC_ARN) {
  throw new Error('Missing required environment variable: ALERT_TOPIC_ARN');
}

const snsClient = new SNSClient({});

export const handler = async (event: EventBridgeEvent<'ImageAnalyzed', DetectionAlert>): Promise<void> => {
  console.log('Processing alert event:', JSON.stringify(event, null, 2));

  const detection = event.detail;

  // Only send alert if there are detections
  if (detection.detectionCount === 0) {
    console.log('No detections, skipping alert');
    return;
  }

  const subject = `🔔 Kamerahavainto: ${detection.cameraName}`;
  
  const message = buildAlertMessage(detection);

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

const buildAlertMessage = (detection: DetectionAlert): string => {
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
  
  lines.push('───────────────────────────────────────');
  lines.push('');
  lines.push('Tämä on automaattinen ilmoitus AI-pohjaisesta');
  lines.push('liikenekameravalvonnasta.');
  
  return lines.join('\n');
};
