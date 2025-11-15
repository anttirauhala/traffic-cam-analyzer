import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import type { ListCameraTimestampsResponse, CameraTimestamp } from '../../shared/api-types';
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

const mapItemToTimestamp = (item: ImageDetectionItem): CameraTimestamp => ({
  capturedAtEpoch: item.capturedAtEpoch,
  capturedAt: item.capturedAt,
  hasWildlife: item.hasWildlife === 'true',
  hasPerson: item.hasPerson === 'true',
  processingStatus: item.processingStatus,
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
    const { cameraId } = event.pathParameters || {};

    if (!cameraId) {
      return errorResponse(400, 'Missing required path parameter: cameraId');
    }

    const params = event.queryStringParameters || {};
    const { startDate, endDate } = params;

    // Parse date filters to epoch timestamps
    let startEpoch: number | undefined;
    let endEpoch: number | undefined;

    if (startDate) {
      const parsed = parseInt(startDate, 10);
      startEpoch = isNaN(parsed) ? Math.floor(new Date(startDate).getTime() / 1000) : parsed;
    }

    if (endDate) {
      const parsed = parseInt(endDate, 10);
      endEpoch = isNaN(parsed) ? Math.floor(new Date(endDate).getTime() / 1000) : parsed;
    }

    // Build query
    const keyConditionParts = ['cameraId = :cameraId'];
    const expressionValues: Record<string, unknown> = {
      ':cameraId': cameraId,
    };

    if (startEpoch && endEpoch) {
      keyConditionParts.push('capturedAtEpoch BETWEEN :start AND :end');
      expressionValues[':start'] = startEpoch;
      expressionValues[':end'] = endEpoch;
    } else if (startEpoch) {
      keyConditionParts.push('capturedAtEpoch >= :start');
      expressionValues[':start'] = startEpoch;
    } else if (endEpoch) {
      keyConditionParts.push('capturedAtEpoch <= :end');
      expressionValues[':end'] = endEpoch;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: DETECTIONS_TABLE_NAME,
        KeyConditionExpression: keyConditionParts.join(' AND '),
        ExpressionAttributeValues: expressionValues,
        ProjectionExpression: 'capturedAtEpoch, capturedAt, hasWildlife, hasPerson, processingStatus',
        ScanIndexForward: false, // newest first
      }),
    );

    const items = (result.Items || []) as ImageDetectionItem[];
    const response: ListCameraTimestampsResponse = {
      cameraId,
      timestamps: items.map(mapItemToTimestamp),
      count: items.length,
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error listing camera timestamps:', error);
    return errorResponse(500, 'Internal server error');
  }
};
