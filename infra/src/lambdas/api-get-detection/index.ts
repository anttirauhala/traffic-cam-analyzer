import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import type { GetDetectionResponse, DetectionDetail } from '../../shared/api-types';
import type { ImageDetectionItem } from '../../shared/analyze-image';

const DETECTIONS_TABLE_NAME = process.env.DETECTIONS_TABLE_NAME;

if (!DETECTIONS_TABLE_NAME) {
  throw new Error('Missing required environment variable: DETECTIONS_TABLE_NAME');
}

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

const errorResponse = (statusCode: number, message: string): APIGatewayProxyResult => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify({ error: 'Error', message }),
});

const successResponse = (data: unknown): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify(data),
});

const mapItemToDetail = (item: ImageDetectionItem): DetectionDetail => ({
  cameraId: item.cameraId,
  capturedAtEpoch: item.capturedAtEpoch,
  capturedAt: item.capturedAt,
  hasWildlife: item.hasWildlife === 'true',
  hasPerson: item.hasPerson === 'true',
  detectionCount: item.detectionCount,
  detectedClasses: item.detectedClasses,
  processingStatus: item.processingStatus,
  rawImageKey: item.rawImageKey,
  processedImageKey: item.processedImageKey || null,
  replicateJobId: item.replicateJobId,
  replicateOutput: item.replicateOutput || null,
  failureReason: item.failureReason || null,
  processedAtEpoch: item.processedAtEpoch,
});

export const handler: APIGatewayProxyHandler = async (event) => {
  // Handle OPTIONS for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const { cameraId, timestamp } = event.pathParameters || {};

    if (!cameraId || !timestamp) {
      return errorResponse(400, 'Missing required path parameters: cameraId and timestamp');
    }

    const capturedAtEpoch = parseInt(timestamp, 10);
    if (isNaN(capturedAtEpoch)) {
      return errorResponse(400, 'Invalid timestamp format');
    }

    const result = await dynamoClient.send(
      new GetCommand({
        TableName: DETECTIONS_TABLE_NAME,
        Key: {
          cameraId,
          capturedAtEpoch,
        },
      }),
    );

    if (!result.Item) {
      return errorResponse(404, 'Detection not found');
    }

    const response: GetDetectionResponse = {
      detection: mapItemToDetail(result.Item as ImageDetectionItem),
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error getting detection:', error);
    return errorResponse(500, 'Internal server error');
  }
};
