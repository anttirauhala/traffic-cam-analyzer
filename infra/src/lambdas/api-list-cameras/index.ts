import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import type { ListCamerasResponse, CameraSummary } from '../../shared/api-types';
import type { CameraItem } from '../../shared/camera-metadata';

const CAMERAS_TABLE_NAME = process.env.CAMERAS_TABLE_NAME;

if (!CAMERAS_TABLE_NAME) {
  throw new Error('Missing required environment variable: CAMERAS_TABLE_NAME');
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
    // Scan cameras table (fast - only camera metadata)
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: CAMERAS_TABLE_NAME,
      }),
    );

    const items = (result.Items || []) as CameraItem[];

    const cameras: CameraSummary[] = items
      .map((item) => ({
        cameraId: item.cameraId,
        name: item.name,
        municipality: item.municipality,
        lat: item.lat,
        lon: item.lon,
        latestCaptureEpoch: item.latestCaptureEpoch,
      }))
      .sort((a, b) => b.latestCaptureEpoch - a.latestCaptureEpoch);

    const response: ListCamerasResponse = {
      cameras,
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error listing cameras:', error);
    return errorResponse(500, 'Internal server error');
  }
};
