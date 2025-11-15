import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput, ScanCommand, ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import type { ListDetectionsRequest, ListDetectionsResponse, DetectionSummary } from '../../shared/api-types';
import type { ImageDetectionItem } from '../../shared/analyze-image';

const DETECTIONS_TABLE_NAME = process.env.DETECTIONS_TABLE_NAME;
const WILDLIFE_GSI_NAME = process.env.WILDLIFE_GSI_NAME || 'hasWildlife-capturedAtEpoch-index';
const PERSON_GSI_NAME = process.env.PERSON_GSI_NAME || 'hasPerson-capturedAtEpoch-index';

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

const mapItemToSummary = (item: ImageDetectionItem): DetectionSummary => ({
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
    const params = event.queryStringParameters || {};
    const limit = params.limit ? Math.min(parseInt(params.limit, 10), 100) : 20;
    const { nextToken, hasWildlife, hasPerson, cameraId, startDate, endDate } = params;

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

    // Use GSI if filtering by wildlife or person
    if (hasWildlife === 'true') {
      const queryInput: QueryCommandInput = {
        TableName: DETECTIONS_TABLE_NAME,
        IndexName: WILDLIFE_GSI_NAME,
        KeyConditionExpression: 'hasWildlife = :hasWildlife',
        ExpressionAttributeValues: {
          ':hasWildlife': 'true',
        },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
      };
      
      const result = await dynamoClient.send(new QueryCommand(queryInput));
      const items = (result.Items || []) as ImageDetectionItem[];
      const response: ListDetectionsResponse = {
        items: items.map(mapItemToSummary),
        count: items.length,
        nextToken: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      };
      return successResponse(response);
    } else if (hasPerson === 'true') {
      const queryInput: QueryCommandInput = {
        TableName: DETECTIONS_TABLE_NAME,
        IndexName: PERSON_GSI_NAME,
        KeyConditionExpression: 'hasPerson = :hasPerson',
        ExpressionAttributeValues: {
          ':hasPerson': 'true',
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
      };
      
      const result = await dynamoClient.send(new QueryCommand(queryInput));
      const items = (result.Items || []) as ImageDetectionItem[];
      const response: ListDetectionsResponse = {
        items: items.map(mapItemToSummary),
        count: items.length,
        nextToken: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      };
      return successResponse(response);
    } else if (cameraId) {
      // Query by cameraId with optional date range
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

      const queryInput: QueryCommandInput = {
        TableName: DETECTIONS_TABLE_NAME,
        KeyConditionExpression: keyConditionParts.join(' AND '),
        ExpressionAttributeValues: expressionValues,
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
      };
      
      const result = await dynamoClient.send(new QueryCommand(queryInput));
      const items = (result.Items || []) as ImageDetectionItem[];
      const response: ListDetectionsResponse = {
        items: items.map(mapItemToSummary),
        count: items.length,
        nextToken: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      };
      return successResponse(response);
    } else {
      // No cameraId - scan table with date filter
      const filterExpressions: string[] = [];
      const expressionValues: Record<string, unknown> = {};

      if (startEpoch && endEpoch) {
        filterExpressions.push('capturedAtEpoch BETWEEN :start AND :end');
        expressionValues[':start'] = startEpoch;
        expressionValues[':end'] = endEpoch;
      } else if (startEpoch) {
        filterExpressions.push('capturedAtEpoch >= :start');
        expressionValues[':start'] = startEpoch;
      } else if (endEpoch) {
        filterExpressions.push('capturedAtEpoch <= :end');
        expressionValues[':end'] = endEpoch;
      }

      const scanInput: ScanCommandInput = {
        TableName: DETECTIONS_TABLE_NAME,
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeValues: Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
        Limit: limit,
        ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
      };

      const result = await dynamoClient.send(new ScanCommand(scanInput));
      const items = (result.Items || []) as ImageDetectionItem[];
      const response: ListDetectionsResponse = {
        items: items.map(mapItemToSummary),
        count: items.length,
        nextToken: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      };
      return successResponse(response);
    }
  } catch (error) {
    console.error('Error listing detections:', error);
    return errorResponse(500, 'Internal server error');
  }
};
